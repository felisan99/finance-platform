import Papa from "papaparse";
import type { ZodError } from "zod";
import { D, ZERO, d } from "@/lib/engine";
import {
  DELTA_REQUIRED_COLUMNS,
  SYNC_NOTE_PREFIX,
  deltaCashRowSchema,
  deltaTradeRowSchema,
} from "@/lib/validation/delta-row";
import type {
  FatalError,
  ImportParseResult,
  InstrumentInfo,
  RowError,
  SkippedRow,
  TransactionDraft,
} from "./types";

// v1 solo maneja USD (spec §15): otras monedas se reportan como no soportadas.
const SUPPORTED_CURRENCY = "USD";
// Los precios se guardan con 8 decimales (numeric(20,8)): se redondea acá para que lo que
// se prueba sea lo que se guarda.
const PRICE_DECIMALS = 8;

type RawRow = Record<string, string | undefined>;

interface Accumulator {
  transactions: TransactionDraft[];
  skipped: SkippedRow[];
  errors: RowError[];
  instruments: Map<string, InstrumentInfo>;
  keyCounts: Map<string, number>;
}

/**
 * Convierte el texto de un export CSV de Delta (spec §8) en transacciones listas para
 * insertar. Función pura: no lee archivos ni toca la base; el llamador pasa el texto.
 * Nada se descarta en silencio: lo ignorado va a `skipped` y lo inválido a `errors`.
 */
export function parseDeltaCsv(text: string): ImportParseResult {
  const input = stripBom(text);
  if (input.trim() === "") {
    return failure({ code: "EMPTY_FILE", message: "El archivo está vacío" });
  }

  const parsed = Papa.parse<RawRow>(input, {
    header: true,
    skipEmptyLines: true,
    delimiter: ",",
    transformHeader: (header) => header.trim(),
  });

  const fields = parsed.meta.fields ?? [];
  const missing = DELTA_REQUIRED_COLUMNS.filter(
    (column) => !fields.includes(column),
  );
  if (missing.length > 0) {
    return failure({
      code: "MISSING_COLUMNS",
      message: `Faltan columnas: ${missing.join(", ")}`,
    });
  }

  // Filas que papaparse marcó como mal formadas (índice de dato, sin contar el encabezado).
  const malformed = new Map<number, string>();
  for (const error of parsed.errors) {
    if (error.row !== undefined && !malformed.has(error.row)) {
      malformed.set(error.row, PAPAPARSE_MESSAGES[error.code] ?? error.message);
    }
  }

  const acc: Accumulator = {
    transactions: [],
    skipped: [],
    errors: [],
    instruments: new Map(),
    keyCounts: new Map(),
  };

  parsed.data.forEach((raw, index) => {
    const row = index + 2; // fila del archivo: el encabezado es la 1
    const problem = malformed.get(index);
    if (problem !== undefined) {
      acc.errors.push({ row, code: "MALFORMED_ROW", message: problem });
      return;
    }
    processRow(row, normalize(raw), acc);
  });

  // El archivo de Delta ya viene en orden cronológico, pero no lo damos por sentado.
  // El sort es estable: las operaciones con la misma fecha conservan el orden del archivo.
  const transactions = [...acc.transactions].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
  );

  return {
    transactions,
    skipped: acc.skipped,
    errors: acc.errors,
    instruments: [...acc.instruments.values()],
    stats: {
      rowsTotal: parsed.data.length,
      imported: transactions.length,
      skipped: acc.skipped.length,
      errors: acc.errors.length,
    },
    fatal: null,
  };
}

function processRow(row: number, raw: RawRow, acc: Accumulator): void {
  const way = raw.Way?.toUpperCase();
  const baseType = raw["Base type"]?.toUpperCase();

  if (way === undefined) {
    acc.errors.push({
      row,
      code: "INVALID_ROW",
      message: "Way: falta el campo",
    });
    return;
  }

  const notes = raw.Notes;
  const normalized: RawRow = { ...raw, Way: way, "Base type": baseType };

  // Patas de efectivo automáticas de Delta: el motor ya deriva el efectivo de BUY/SELL.
  if (
    (way === "DEPOSIT" || way === "WITHDRAW") &&
    notes?.startsWith(SYNC_NOTE_PREFIX)
  ) {
    skip(
      acc,
      row,
      "SYNC_BASE_HOLDINGS_LEG",
      `Pata de efectivo automática de Delta (${notes})`,
    );
    return;
  }

  if (way === "BUY" || way === "SELL") {
    if (baseType !== "STOCK" && baseType !== "FUND") {
      skip(
        acc,
        row,
        "UNSUPPORTED_ASSET_TYPE",
        `Base type "${raw["Base type"] ?? ""}" no soportado`,
      );
      return;
    }
    processTrade(row, normalized, acc);
    return;
  }

  if (way === "DEPOSIT" || way === "WITHDRAW") {
    if (baseType !== "FIAT") {
      skip(
        acc,
        row,
        "UNSUPPORTED_ASSET_TYPE",
        `Base type "${raw["Base type"] ?? ""}" no soportado`,
      );
      return;
    }
    processCash(row, normalized, acc);
    return;
  }

  skip(acc, row, "UNSUPPORTED_WAY", `Way "${raw.Way ?? ""}" no soportado`);
}

function processTrade(row: number, raw: RawRow, acc: Accumulator): void {
  const parsed = deltaTradeRowSchema.safeParse(raw);
  if (!parsed.success) {
    acc.errors.push({
      row,
      code: "INVALID_ROW",
      message: describe(parsed.error),
    });
    return;
  }
  const r = parsed.data;

  const instrument = parseInstrument(r["Base currency (name)"]);
  if (!instrument) {
    acc.errors.push({
      row,
      code: "INVALID_SYMBOL",
      message: `No se pudo leer el símbolo de "${r["Base currency (name)"]}"`,
    });
    return;
  }

  const quoteCurrency = currencyCode(r["Quote currency"]);
  if (quoteCurrency !== SUPPORTED_CURRENCY) {
    skip(
      acc,
      row,
      "UNSUPPORTED_CURRENCY",
      `Quote currency ${quoteCurrency} no soportada (solo ${SUPPORTED_CURRENCY})`,
    );
    return;
  }

  const quantity = d(r["Base amount"]);
  if (!quantity.gt(0)) {
    acc.errors.push({
      row,
      code: "INVALID_QUANTITY",
      message: "La cantidad (Base amount) debe ser mayor que 0",
    });
    return;
  }
  const total = d(r["Quote amount"]); // TOTAL de la operación, no el precio unitario
  if (total.lt(0)) {
    acc.errors.push({
      row,
      code: "INVALID_AMOUNT",
      message: "El monto (Quote amount) no puede ser negativo",
    });
    return;
  }
  const fee = r["Fee amount"] === undefined ? ZERO : d(r["Fee amount"]);
  if (fee.lt(0)) {
    acc.errors.push({
      row,
      code: "INVALID_AMOUNT",
      message: "La comisión (Fee amount) no puede ser negativa",
    });
    return;
  }
  const feeCurrencyText = r["Fee currency (name)"];
  if (
    fee.gt(0) &&
    feeCurrencyText !== undefined &&
    currencyCode(feeCurrencyText) !== SUPPORTED_CURRENCY
  ) {
    skip(
      acc,
      row,
      "UNSUPPORTED_CURRENCY",
      `Fee currency ${currencyCode(feeCurrencyText)} no soportada (solo ${SUPPORTED_CURRENCY})`,
    );
    return;
  }

  const executedAt = new Date(r.Date);
  const price = total
    .div(quantity)
    .toDecimalPlaces(PRICE_DECIMALS, D.ROUND_HALF_UP);

  acc.transactions.push({
    type: r.Way,
    symbol: instrument.symbol,
    executedAt,
    currency: SUPPORTED_CURRENCY,
    notes: r.Notes ?? null,
    quantity,
    price,
    fee,
    source: "delta_csv",
    externalId: externalId(
      acc,
      executedAt,
      r.Way,
      instrument.symbol,
      quantity.toFixed(),
      total.toFixed(),
    ),
    sourceRow: row,
  });
  if (!acc.instruments.has(instrument.symbol)) {
    acc.instruments.set(instrument.symbol, {
      symbol: instrument.symbol,
      name: instrument.name,
      type: r["Base type"] === "FUND" ? "ETF" : "STOCK",
    });
  }
}

function processCash(row: number, raw: RawRow, acc: Accumulator): void {
  const parsed = deltaCashRowSchema.safeParse(raw);
  if (!parsed.success) {
    acc.errors.push({
      row,
      code: "INVALID_ROW",
      message: describe(parsed.error),
    });
    return;
  }
  const r = parsed.data;

  const currency = currencyCode(r["Base currency (name)"]);
  if (currency !== SUPPORTED_CURRENCY) {
    skip(
      acc,
      row,
      "UNSUPPORTED_CURRENCY",
      `Base currency ${currency} no soportada (solo ${SUPPORTED_CURRENCY})`,
    );
    return;
  }
  const amount = d(r["Base amount"]);
  if (!amount.gt(0)) {
    acc.errors.push({
      row,
      code: "INVALID_AMOUNT",
      message: "El monto (Base amount) debe ser mayor que 0",
    });
    return;
  }

  const executedAt = new Date(r.Date);
  acc.transactions.push({
    type: r.Way === "DEPOSIT" ? "DEPOSIT" : "WITHDRAWAL",
    symbol: null,
    executedAt,
    currency,
    notes: r.Notes ?? null,
    amount,
    source: "delta_csv",
    externalId: externalId(acc, executedAt, r.Way, "", amount.toFixed(), ""),
    sourceRow: row,
  });
}

/**
 * Clave de deduplicación: fecha + way + símbolo + cantidad + total (spec §8.2), con los
 * decimales en forma canónica. Las filas idénticas dentro del mismo archivo llevan sufijo
 * `#2`, `#3`…: sin él, dos ejecuciones iguales colapsarían por la restricción unique.
 */
function externalId(
  acc: Accumulator,
  executedAt: Date,
  way: string,
  symbol: string,
  baseAmount: string,
  quoteAmount: string,
): string {
  const key = `delta:${executedAt.toISOString()}|${way}|${symbol}|${baseAmount}|${quoteAmount}`;
  const seen = (acc.keyCounts.get(key) ?? 0) + 1;
  acc.keyCounts.set(key, seen);
  return seen === 1 ? key : `${key}#${seen}`;
}

/**
 * `"VOO (Vanguard S&P 500 ETF)"` -> `{ symbol: "VOO", name: "Vanguard S&P 500 ETF" }`.
 * El símbolo va en mayúsculas y con `-` en vez de `.` (BRK.B -> BRK-B, como en Yahoo).
 */
export function parseInstrument(
  text: string,
): { symbol: string; name: string | null } | null {
  const match = /^\s*(\S+)\s*(?:\(([\s\S]*)\))?\s*$/.exec(text);
  if (!match) return null;
  const symbol = (match[1] ?? "").toUpperCase().replace(/\./g, "-");
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(symbol)) return null;
  const name = match[2]?.trim();
  return { symbol, name: name ? name : null };
}

/** `"USD (United States dollar)"` -> `"USD"`. */
export function currencyCode(text: string): string {
  return (text.trim().split(/\s+/)[0] ?? "").toUpperCase();
}

function skip(
  acc: Accumulator,
  row: number,
  reason: SkippedRow["reason"],
  detail: string,
): void {
  acc.skipped.push({ row, reason, detail });
}

function normalize(raw: RawRow): RawRow {
  const out: RawRow = {};
  for (const [key, value] of Object.entries(raw)) {
    // Papaparse agrega `__parsed_extra` (un arreglo) cuando sobran campos: se ignora.
    const trimmed = typeof value === "string" ? value.trim() : undefined;
    out[key] = trimmed === "" ? undefined : trimmed;
  }
  return out;
}

function describe(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "fila"}: ${issue.message}`)
    .join("; ");
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function failure(fatal: FatalError): ImportParseResult {
  return {
    transactions: [],
    skipped: [],
    errors: [],
    instruments: [],
    stats: { rowsTotal: 0, imported: 0, skipped: 0, errors: 0 },
    fatal,
  };
}

const PAPAPARSE_MESSAGES: Record<string, string> = {
  TooFewFields: "Faltan campos en la fila",
  TooManyFields: "Sobran campos en la fila",
  MissingQuotes: "Comillas sin cerrar",
  InvalidQuotes: "Comillas mal cerradas",
};
