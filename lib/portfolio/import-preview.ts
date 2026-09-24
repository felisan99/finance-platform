import { validateLedgerChange, type Transaction } from "@/lib/engine";
import {
  toEngineTransactions,
  type FatalError,
  type ImportParseResult,
  type InstrumentInfo,
  type RowError,
  type SkipReason,
  type TransactionDraft,
} from "@/lib/importers";
import { describeIssue } from "./issues";

// Vista previa de una importación (spec §8.2): qué se va a crear, qué se ignora y por qué, qué
// errores hay y cómo quedaría el portafolio. Es una función pura: el servidor le pasa lo ya
// parseado y lo que existe en la base. `view` es serializable (va al cliente); `toInsert` no sale
// del servidor: la confirmación vuelve a parsear el archivo y no confía en nada del cliente.

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  SYNC_BASE_HOLDINGS_LEG:
    "Patas de efectivo automáticas de Delta (se ignoran a propósito: el efectivo se calcula solo)",
  UNSUPPORTED_WAY: "Tipo de operación que todavía no se importa",
  UNSUPPORTED_ASSET_TYPE: "Tipo de activo no soportado (solo acciones y ETFs)",
  UNSUPPORTED_CURRENCY: "Moneda no soportada (solo USD)",
};

const MAX_ERRORS_SHOWN = 50;
const ROW_EXAMPLES = 5;

export interface ImportPreviewView {
  fatal: FatalError | null;
  /** Filas de datos del archivo. */
  fileRows: number;
  newCount: number;
  /** Ya importadas antes (mismo `external_id`): no se vuelven a crear. */
  duplicateCount: number;
  newByType: Array<{ type: string; count: number }>;
  skipped: Array<{
    reason: SkipReason;
    label: string;
    count: number;
    rows: number[];
  }>;
  errors: RowError[];
  errorCount: number;
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
  /** Los instrumentos a crear, con nombre y tipo del archivo. */
  newInstruments: InstrumentInfo[];
}

export interface ImportPreviewArgs {
  parsed: ImportParseResult;
  /** `external_id` de lo ya importado desde este origen en la cuenta. */
  importedExternalIds: ReadonlySet<string>;
  existingTransactions: readonly Transaction[];
  /** Símbolos que ya existen en `instruments`. */
  knownSymbols: ReadonlySet<string>;
  accountId: string;
  now: Date;
  currency?: string;
}

const EMPTY_VIEW: ImportPreviewView = {
  fatal: null,
  fileRows: 0,
  newCount: 0,
  duplicateCount: 0,
  newByType: [],
  skipped: [],
  errors: [],
  errorCount: 0,
  newSymbols: [],
  after: null,
  problems: [],
  warnings: [],
  canConfirm: false,
};

export function buildImportPreview(args: ImportPreviewArgs): ImportPreview {
  const { parsed } = args;
  if (parsed.fatal) {
    return {
      view: {
        ...EMPTY_VIEW,
        fatal: parsed.fatal,
        problems: [parsed.fatal.message],
      },
      toInsert: [],
      newInstruments: [],
    };
  }

  const toInsert = parsed.transactions.filter(
    (t) => !args.importedExternalIds.has(t.externalId),
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
  const problems: string[] = [];
  if (parsed.errors.length > 0) {
    problems.push(
      `El archivo tiene ${parsed.errors.length} fila${parsed.errors.length === 1 ? "" : "s"} con errores. Corregilas y volvé a subirlo: importar sin ellas dejaría las cuentas mal.`,
    );
  }
  for (const issue of check.newErrors)
    problems.push(describeIssue(issue, rowOf));
  if (toInsert.length === 0) {
    problems.push(
      parsed.transactions.length === 0
        ? "El archivo no tiene operaciones para importar."
        : "No hay operaciones nuevas: todas ya estaban importadas.",
    );
  }
  const warnings = check.newWarnings.map((issue) =>
    describeIssue(issue, rowOf),
  );

  const newInstruments = parsed.instruments.filter(
    (i) =>
      !args.knownSymbols.has(i.symbol) &&
      toInsert.some((t) => "symbol" in t && t.symbol === i.symbol),
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
      fileRows: parsed.stats.rowsTotal,
      newCount: toInsert.length,
      duplicateCount: parsed.transactions.length - toInsert.length,
      newByType: [...byType].map(([type, count]) => ({ type, count })),
      skipped: [...skipped].map(([reason, rows]) => ({
        reason,
        label: SKIP_REASON_LABELS[reason],
        count: rows.length,
        rows: rows.slice(0, ROW_EXAMPLES),
      })),
      errors: parsed.errors.slice(0, MAX_ERRORS_SHOWN),
      errorCount: parsed.errors.length,
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
      problems,
      warnings,
      canConfirm: problems.length === 0,
    },
    toInsert,
    newInstruments,
  };
}
