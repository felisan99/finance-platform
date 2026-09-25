import { validateLedgerChange, type Transaction } from "@/lib/engine";
import {
  FORMAT_LABELS,
  toEngineTransactions,
  type FatalError,
  type ImportFormat,
  type ImportParseResult,
  type InstrumentInfo,
  type RowError,
  type SkipReason,
  type TransactionDraft,
} from "@/lib/importers";
import type { ResolveResult } from "@/lib/market-jobs/instruments";
import { formatDate, formatMoney, formatPrice, formatQuantity } from "./format";
import { findSimilar } from "./import-similar";
import { MAX_VERIFIED_SYMBOLS } from "./import-symbols";
import { describeIssue } from "./issues";
import { formatSplitRatio } from "./tx-view";
import { TRANSACTION_TYPE_LABELS } from "@/lib/validation/transaction";

// Vista previa de una importación (spec §8.2): qué se va a crear, qué se ignora y por qué, qué
// errores hay y cómo quedaría el portafolio. Es una función pura: el servidor le pasa lo ya
// parseado y lo que existe en la base. `view` es serializable (va al cliente, con los textos ya
// formateados); `toInsert` no sale del servidor: la confirmación vuelve a parsear el archivo y no
// confía en nada del cliente.

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  SYNC_BASE_HOLDINGS_LEG:
    "Patas de efectivo automáticas de Delta (se ignoran a propósito: el efectivo se calcula solo)",
  UNSUPPORTED_WAY: "Tipo de operación que todavía no se importa",
  UNSUPPORTED_ASSET_TYPE: "Tipo de activo no soportado (solo acciones y ETFs)",
  UNSUPPORTED_CURRENCY: "Moneda no soportada (solo USD)",
};

export const ERROR_CODE_LABELS: Record<RowError["code"], string> = {
  MALFORMED_ROW: "Filas mal formadas",
  INVALID_ROW: "Filas con datos inválidos",
  INVALID_SYMBOL: "Símbolos inválidos",
  INVALID_QUANTITY: "Cantidades inválidas",
  INVALID_AMOUNT: "Montos inválidos",
  INVALID_DATE: "Fechas inválidas",
  INVALID_TYPE: "Tipos de operación que no reconocemos",
  INVALID_PRICE: "Precios inválidos",
  INVALID_FEE: "Comisiones inválidas",
  INVALID_SPLIT: "Razones de split inválidas",
  TEMPLATE_ROW: "Filas de ejemplo de la plantilla",
};

const MAX_ERRORS_SHOWN = 50;
const ROW_EXAMPLES = 5;
const ERROR_EXAMPLES = 5;
/** Filas que la vista previa lista (las de más se cuentan, no se mandan al navegador). */
export const MAX_ROWS_SHOWN = 200;
/** Tope de filas de una importación (lo que acepta `import_transactions`). */
export const MAX_IMPORT_ROWS = 5000;

/** Una operación interpretada, con los textos ya listos para mostrar (fecha, tipo, cantidades). */
export interface ImportRowView {
  /** Fila del archivo (el encabezado es la 1). */
  row: number;
  /** `09/03/2026`, en hora de Montevideo. */
  date: string;
  typeLabel: string;
  /** Vacío en depósitos, retiros, comisiones, impuestos e intereses. */
  symbol: string;
  /** `3 × US$ 575,24 · comisión US$ 1,00`, `US$ 1.000,00`, `10 por 1`. */
  detail: string;
}

export interface ImportErrorGroup {
  code: RowError["code"];
  label: string;
  count: number;
  examples: Array<{ row: number; message: string }>;
}

/** Un monto en dos formas: redondeado a centavos y exacto (para contrastar contra otra fuente). */
export interface TextPair {
  money: string;
  exact: string;
}

export interface ImportPreviewView {
  fatal: FatalError | null;
  /** Formato reconocido por los encabezados; `null` si no se reconoció ninguno. */
  format: { key: ImportFormat; label: string } | null;
  /** Filas de datos del archivo. */
  fileRows: number;
  newCount: number;
  /** Ya importadas antes (mismo `external_id`): no se vuelven a crear. */
  duplicateCount: number;
  /** Las operaciones que se van a crear, interpretadas (hasta `MAX_ROWS_SHOWN`). */
  rows: ImportRowView[];
  /** Cuántas más hay que no se listan. */
  rowsHidden: number;
  /** Parecen repetir operaciones que ya tenías (mismo día, tipo, símbolo y cantidad). */
  suspected: ImportRowView[];
  suspectedCount: number;
  /** Con `true` estas también se importan (la persona tildó «Importar igual»). */
  suspectedIncluded: boolean;
  newByType: Array<{ type: string; label: string; count: number }>;
  skipped: Array<{
    reason: SkipReason;
    label: string;
    count: number;
    rows: number[];
  }>;
  errors: RowError[];
  errorCount: number;
  /** Los errores agrupados por causa, con las primeras filas de cada una. */
  errorGroups: ImportErrorGroup[];
  /** Símbolos que todavía no existen en la base y se van a crear. */
  newSymbols: string[];
  /** Cómo quedaría el portafolio (montos como texto decimal). `null` si no se puede calcular. */
  after: {
    cash: string;
    openCostBasis: string;
    realizedPnl: string;
    openPositions: Array<{
      symbol: string;
      quantity: string;
      costBasis: string;
    }>;
  } | null;
  /** Lo mismo que `after`, ya formateado para mostrar (el navegador no importa el formato). */
  afterText: {
    cash: TextPair;
    openCostBasis: TextPair;
    realizedPnl: TextPair;
    openPositions: Array<{
      symbol: string;
      quantity: string;
      costBasis: string;
    }>;
  } | null;
  /** Motivos que impiden confirmar. */
  problems: string[];
  /** Avisos que no impiden confirmar. */
  warnings: string[];
  canConfirm: boolean;
}

export interface ImportPreview {
  view: ImportPreviewView;
  /** Las operaciones nuevas (sin las ya importadas), listas para el RPC. Solo del lado del servidor. */
  toInsert: TransactionDraft[];
  /** Los instrumentos a crear, con nombre y tipo del archivo (o del proveedor). */
  newInstruments: InstrumentInfo[];
}

export interface ImportPreviewArgs {
  parsed: ImportParseResult;
  /** Formato reconocido; solo rotula la vista. */
  format?: ImportFormat | null;
  /** `external_id` de lo ya importado desde este origen en la cuenta. */
  importedExternalIds: ReadonlySet<string>;
  existingTransactions: readonly Transaction[];
  /** Símbolos que ya existen en `instruments`. */
  knownSymbols: ReadonlySet<string>;
  /**
   * Resultado de verificar con el proveedor los símbolos nuevos (el formato simple, escrito a mano).
   * `null` o ausente: no se verifican (un export de Delta lo genera una máquina) y los instrumentos
   * salen del archivo.
   */
  symbolChecks?: ReadonlyMap<string, ResolveResult> | null;
  /** Importar también lo que parece repetir operaciones ya cargadas. */
  includeSuspected?: boolean;
  accountId: string;
  now: Date;
  currency?: string;
}

const EMPTY_VIEW: ImportPreviewView = {
  fatal: null,
  format: null,
  fileRows: 0,
  newCount: 0,
  duplicateCount: 0,
  rows: [],
  rowsHidden: 0,
  suspected: [],
  suspectedCount: 0,
  suspectedIncluded: false,
  newByType: [],
  skipped: [],
  errors: [],
  errorCount: 0,
  errorGroups: [],
  newSymbols: [],
  after: null,
  afterText: null,
  problems: [],
  warnings: [],
  canConfirm: false,
};

const symbolOf = (draft: TransactionDraft): string | null =>
  "symbol" in draft ? draft.symbol : null;

function describeDraft(draft: TransactionDraft): ImportRowView {
  let detail = "";
  switch (draft.type) {
    case "BUY":
    case "SELL":
      detail = `${formatQuantity(draft.quantity)} × ${formatPrice(draft.price)}`;
      if (!draft.fee.isZero())
        detail += ` · comisión ${formatMoney(draft.fee)}`;
      break;
    case "SPLIT":
      detail = formatSplitRatio(draft.splitRatio);
      break;
    default:
      detail = formatMoney(draft.amount);
  }
  return {
    row: draft.sourceRow,
    date: formatDate(draft.executedAt),
    typeLabel: TRANSACTION_TYPE_LABELS[draft.type],
    symbol:
      draft.type === "DEPOSIT" || draft.type === "WITHDRAWAL"
        ? ""
        : (symbolOf(draft) ?? ""),
    detail,
  };
}

function groupErrors(errors: readonly RowError[]): ImportErrorGroup[] {
  const groups = new Map<RowError["code"], ImportErrorGroup>();
  for (const error of errors) {
    const group = groups.get(error.code) ?? {
      code: error.code,
      label: ERROR_CODE_LABELS[error.code],
      count: 0,
      examples: [],
    };
    group.count += 1;
    if (group.examples.length < ERROR_EXAMPLES) {
      group.examples.push({ row: error.row, message: error.message });
    }
    groups.set(error.code, group);
  }
  return [...groups.values()];
}

/** Lo que dice la vista de un símbolo que el proveedor no reconoce. */
function symbolProblem(symbol: string, check: ResolveResult): string {
  if (check.ok) return "";
  return check.reason === "NOT_FOUND"
    ? `Símbolo «${symbol}»: no lo encontramos. Revisá que esté bien escrito.`
    : `Símbolo «${symbol}»: ${check.message}`;
}

export function buildImportPreview(args: ImportPreviewArgs): ImportPreview {
  const { parsed } = args;
  const format = args.format
    ? { key: args.format, label: FORMAT_LABELS[args.format] }
    : null;
  if (parsed.fatal) {
    return {
      view: {
        ...EMPTY_VIEW,
        fatal: parsed.fatal,
        format,
        problems: [parsed.fatal.message],
      },
      toInsert: [],
      newInstruments: [],
    };
  }

  const notImported = parsed.transactions.filter(
    (t) => !args.importedExternalIds.has(t.externalId),
  );
  const includeSuspected = args.includeSuspected === true;
  const similar = findSimilar(notImported, args.existingTransactions);
  const candidates = includeSuspected
    ? notImported
    : notImported.filter((t) => !similar.has(t));

  // Símbolos nuevos del formato simple: existen y son acciones o ETFs en USD, o la fila es un error.
  const checks = args.symbolChecks ?? null;
  const verifyErrors: RowError[] = [];
  const problems: string[] = [];
  const failed = new Set<string>();
  if (checks !== null) {
    const unavailable = new Set<string>();
    const unchecked = new Set<string>();
    for (const draft of candidates) {
      const symbol = symbolOf(draft);
      if (symbol === null || args.knownSymbols.has(symbol)) continue;
      const check = checks.get(symbol);
      if (check === undefined) {
        unchecked.add(symbol);
      } else if (!check.ok && check.reason === "UNAVAILABLE") {
        unavailable.add(symbol);
      } else if (!check.ok) {
        failed.add(symbol);
        verifyErrors.push({
          row: draft.sourceRow,
          code: "INVALID_SYMBOL",
          message: symbolProblem(symbol, check),
        });
      }
    }
    if (unavailable.size > 0) {
      problems.push(
        `No pudimos verificar ${[...unavailable].join(", ")} con Yahoo Finance ahora. Probá de nuevo en unos minutos.`,
      );
    }
    if (unchecked.size > 0) {
      problems.push(
        `El archivo tiene más de ${MAX_VERIFIED_SYMBOLS} símbolos nuevos: importalo en partes.`,
      );
    }
  }
  const toInsert = candidates.filter((t) => {
    const symbol = symbolOf(t);
    return symbol === null || !failed.has(symbol);
  });

  const errors = [...parsed.errors, ...verifyErrors].sort(
    (a, b) => a.row - b.row,
  );
  const engineTxs = toEngineTransactions(toInsert, {
    accountId: args.accountId,
    importedAt: args.now,
  });
  const check = validateLedgerChange(
    args.existingTransactions,
    { kind: "addMany", txs: engineTxs },
    args.currency ? { currency: args.currency } : {},
  );

  const rowOf = new Map(toInsert.map((t) => [t.externalId, t.sourceRow]));
  if (errors.length > 0) {
    const rowsWithErrors = new Set(errors.map((e) => e.row)).size;
    problems.unshift(
      `El archivo tiene ${rowsWithErrors} fila${rowsWithErrors === 1 ? "" : "s"} con errores. Corregilas y volvé a subirlo: importar sin ellas dejaría las cuentas mal.`,
    );
  }
  for (const issue of check.newErrors)
    problems.push(describeIssue(issue, rowOf));
  if (toInsert.length > MAX_IMPORT_ROWS) {
    problems.push(
      `El archivo tiene ${toInsert.length} operaciones y se pueden importar hasta ${MAX_IMPORT_ROWS} por vez: dividilo en partes.`,
    );
  }
  if (toInsert.length === 0 && errors.length === 0) {
    const onlySuspected =
      !includeSuspected && notImported.length > 0 && similar.size > 0;
    problems.push(
      parsed.transactions.length === 0
        ? "El archivo no tiene operaciones para importar."
        : onlySuspected
          ? "Todas las operaciones parecen repetir las que ya tenés cargadas. Si no lo son, tildá «Importar igual»."
          : "No hay operaciones nuevas: todas ya estaban importadas.",
    );
  }
  const warnings = check.newWarnings.map((issue) =>
    describeIssue(issue, rowOf),
  );

  // Con verificación, los instrumentos nuevos salen del proveedor (nombre y tipo reales); sin ella,
  // del archivo.
  const used = (symbol: string) => toInsert.some((t) => symbolOf(t) === symbol);
  const newInstruments: InstrumentInfo[] =
    checks !== null
      ? [...checks.entries()].flatMap(([symbol, result]) =>
          result.ok && !args.knownSymbols.has(symbol) && used(symbol)
            ? [result.instrument]
            : [],
        )
      : parsed.instruments.filter(
          (i) => !args.knownSymbols.has(i.symbol) && used(i.symbol),
        );

  const byType = new Map<string, number>();
  for (const t of toInsert) byType.set(t.type, (byType.get(t.type) ?? 0) + 1);

  const skipped = new Map<SkipReason, number[]>();
  for (const s of parsed.skipped) {
    skipped.set(s.reason, [...(skipped.get(s.reason) ?? []), s.row]);
  }

  const after = check.after;
  return {
    view: {
      fatal: null,
      format,
      fileRows: parsed.stats.rowsTotal,
      newCount: toInsert.length,
      duplicateCount: parsed.transactions.length - notImported.length,
      rows: toInsert.slice(0, MAX_ROWS_SHOWN).map(describeDraft),
      rowsHidden: Math.max(0, toInsert.length - MAX_ROWS_SHOWN),
      suspected: [...similar].slice(0, MAX_ROWS_SHOWN).map(describeDraft),
      suspectedCount: similar.size,
      suspectedIncluded: includeSuspected,
      newByType: [...byType].map(([type, count]) => ({
        type,
        label:
          TRANSACTION_TYPE_LABELS[
            type as keyof typeof TRANSACTION_TYPE_LABELS
          ] ?? type,
        count,
      })),
      skipped: [...skipped].map(([reason, rows]) => ({
        reason,
        label: SKIP_REASON_LABELS[reason],
        count: rows.length,
        rows: rows.slice(0, ROW_EXAMPLES),
      })),
      errors: errors.slice(0, MAX_ERRORS_SHOWN),
      errorCount: errors.length,
      errorGroups: groupErrors(errors),
      newSymbols: newInstruments.map((i) => i.symbol),
      after: {
        cash: after.cash.toFixed(),
        openCostBasis: after.totals.openCostBasis.toFixed(),
        realizedPnl: after.totals.realizedPnl.toFixed(),
        openPositions: after.positions
          .filter((p) => p.isOpen)
          .map((p) => ({
            symbol: p.symbol,
            quantity: p.quantity.toFixed(),
            costBasis: p.costBasis.toFixed(),
          })),
      },
      afterText: {
        cash: {
          money: formatMoney(after.cash),
          exact: formatQuantity(after.cash),
        },
        openCostBasis: {
          money: formatMoney(after.totals.openCostBasis),
          exact: formatQuantity(after.totals.openCostBasis),
        },
        realizedPnl: {
          money: formatMoney(after.totals.realizedPnl, { signed: true }),
          exact: formatQuantity(after.totals.realizedPnl),
        },
        openPositions: after.positions
          .filter((p) => p.isOpen)
          .map((p) => ({
            symbol: p.symbol,
            quantity: formatQuantity(p.quantity),
            costBasis: formatMoney(p.costBasis),
          })),
      },
      problems,
      warnings,
      canConfirm: problems.length === 0,
    },
    toInsert,
    newInstruments,
  };
}
