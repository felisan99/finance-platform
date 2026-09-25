import Papa from "papaparse";
import { ZERO, type Dec, type TxType } from "@/lib/engine";
import { cleanText } from "@/lib/market-data/sanitize";
import { parseLocalInput } from "@/lib/portfolio/time";
import {
  MAX_NOTES,
  SYMBOL_PATTERN,
  dateRangeError,
  normalizeSymbol,
  parseDecimalText,
  type DecimalRules,
} from "@/lib/validation/transaction";
import { currencyCode, stripBom } from "./delta";
import { failure } from "./failure";
import type {
  ImportParseResult,
  InstrumentInfo,
  RowError,
  SkippedRow,
  TransactionDraft,
} from "./types";

// Importador del formato simple («Portfolio Tracker»): el mismo que escribe «Exportar CSV», con
// encabezados tolerantes, para que un archivo armado a mano (o exportado y corregido) entre sin
// pelear con el formato. Función pura: no lee archivos ni toca la base ni el reloj (`now` entra por
// parámetro). Nada se descarta en silencio: lo ignorado va a `skipped` y lo inválido a `errors`.

const SUPPORTED_CURRENCY = "USD";
/** Con menos de este largo un `shown()` recorta el valor que se muestra en un mensaje. */
const SHOWN_MAX = 30;
const DELIMITERS = [",", ";", "\t"];

type RawRow = Record<string, string | undefined>;

export type Field =
  | "date"
  | "type"
  | "symbol"
  | "quantity"
  | "price"
  | "amount"
  | "fee"
  | "splitRatio"
  | "currency"
  | "notes";

/**
 * Nombres con los que se reconoce cada columna, ya normalizados (`normalizeHeader`), en orden de
 * prioridad: el export propio trae `fecha_utc` y `fecha_montevideo`, y gana el instante exacto.
 */
const ALIASES: Record<Field, readonly string[]> = {
  date: [
    "fecha_utc",
    "fecha",
    "date",
    "fecha_y_hora",
    "fecha_hora",
    "fecha_montevideo",
  ],
  type: ["tipo", "type", "operacion", "tipo_de_operacion"],
  symbol: ["simbolo", "symbol", "ticker", "activo", "instrumento"],
  quantity: ["cantidad", "quantity", "qty", "acciones", "unidades"],
  price: [
    "precio",
    "price",
    "precio_usd",
    "price_usd",
    "precio_unitario",
    "precio_por_unidad",
  ],
  amount: ["monto", "amount", "importe", "monto_usd", "amount_usd"],
  fee: [
    "comision",
    "fee",
    "comision_usd",
    "fee_usd",
    "comisiones",
    "commission",
  ],
  splitRatio: ["razon_split", "split_ratio", "razon_del_split", "razon"],
  currency: ["moneda", "currency", "divisa"],
  notes: ["notas", "notes", "nota", "comentarios", "observaciones"],
};

// Con `new RegExp` y `String.raw`: el target de TypeScript no admite `\p{…}` en un literal, y un
// escape `\u0300` escrito directo lo convierte Prettier en un carácter invisible.
const COMBINING_MARKS = new RegExp(String.raw`\p{M}`, "gu");

/** `Símbolo`, ` Precio (USD) ` → `simbolo`, `precio_usd`: sin tildes, minúsculas, `_` entre palabras. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export type ColumnMap = Partial<Record<Field, string>>;

/** Qué columna del archivo cumple cada papel (`undefined` si no está). Recibe encabezados crudos. */
export function resolveColumns(headers: readonly string[]): ColumnMap {
  const present = new Set(headers.map(normalizeHeader));
  const map: ColumnMap = {};
  for (const [field, aliases] of Object.entries(ALIASES) as Array<
    [Field, readonly string[]]
  >) {
    const found = aliases.find((alias) => present.has(alias));
    if (found !== undefined) map[field] = found;
  }
  return map;
}

// Con Map y no con un objeto: un tipo escrito `constructor` no puede encontrar nada heredado.
const TYPE_WORDS = new Map<string, TxType>([
  ["buy", "BUY"],
  ["compra", "BUY"],
  ["comprar", "BUY"],
  ["sell", "SELL"],
  ["venta", "SELL"],
  ["vender", "SELL"],
  ["dividend", "DIVIDEND"],
  ["dividendo", "DIVIDEND"],
  ["dividendos", "DIVIDEND"],
  ["deposit", "DEPOSIT"],
  ["deposito", "DEPOSIT"],
  ["depositar", "DEPOSIT"],
  ["withdrawal", "WITHDRAWAL"],
  ["withdraw", "WITHDRAWAL"],
  ["retiro", "WITHDRAWAL"],
  ["retirar", "WITHDRAWAL"],
  ["fee", "FEE"],
  ["comision", "FEE"],
  ["tax", "TAX"],
  ["impuesto", "TAX"],
  ["interest", "INTEREST"],
  ["interes", "INTEREST"],
  ["split", "SPLIT"],
]);

const TYPE_HINT =
  "compra, venta, depósito, retiro, dividendo, split, comisión, impuesto o interés";

// Mismos límites de dígitos que el formulario manual (`lib/validation/transaction.ts`).
const QUANTITY: DecimalRules = { maxInt: 7, maxDecimals: 8, rule: "positive" };
const PRICE: DecimalRules = { maxInt: 7, maxDecimals: 8, rule: "nonNegative" };
const FEE: DecimalRules = { maxInt: 11, maxDecimals: 4, rule: "nonNegative" };
const AMOUNT: DecimalRules = { maxInt: 11, maxDecimals: 4, rule: "positive" };
const SIGNED_AMOUNT: DecimalRules = {
  maxInt: 11,
  maxDecimals: 4,
  rule: "nonZero",
};
const SPLIT_RATIO: DecimalRules = {
  maxInt: 7,
  maxDecimals: 8,
  rule: "positive",
};

type Code = RowError["code"];
type Parsed<T> =
  { ok: true; value: T } | { ok: false; code: Code; message: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (code: Code, message: string): Parsed<never> => ({
  ok: false,
  code,
  message,
});

/** Un valor del archivo para citarlo en un mensaje: sin caracteres raros y acotado. */
const shown = (text: string): string => cleanText(text, SHOWN_MAX) ?? "";

const valueOf = (
  raw: RawRow,
  column: string | undefined,
): string | undefined => {
  if (column === undefined) return undefined;
  const value = raw[column];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

// --- Fechas ---------------------------------------------------------------------------------------

const ISO_ZONED =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_LOCAL =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const DAY_FIRST =
  /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** Hora que se asume cuando el archivo trae solo el día: mediodía de Montevideo. */
const DEFAULT_HOUR = 12;
const DATE_HINT =
  "Usá AAAA-MM-DD (2026-03-09) o DD/MM/AAAA (09/03/2026), con el día antes que el mes";

function realDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const pad2 = (value: string | number) => String(value).padStart(2, "0");

/**
 * Texto → instante. Con zona (`Z` o `±hh:mm`) se respeta; sin zona es hora de Montevideo, y sin
 * hora es el mediodía de ese día (mismo día en Nueva York). El día va antes que el mes en
 * `DD/MM/AAAA`. Rechaza fechas que no existen (31/02), futuras y de antes de 1990.
 */
export function parseImportDate(text: string, now: Date): Parsed<Date> {
  const value = text.trim();
  const invalid = () =>
    fail("INVALID_DATE", `Fecha «${shown(value)}»: no es válida. ${DATE_HINT}`);

  let instant: Date | null = null;
  if (ISO_ZONED.test(value)) {
    // `new Date` "corrige" en silencio un 30 de febrero o las 24:00: se revisa antes.
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    const [hour, minute, second] = value
      .slice(11, 19)
      .split(":")
      .map((part) => Number(part || 0));
    if (
      !realDay(year ?? 0, month ?? 0, day ?? 0) ||
      (hour ?? 0) > 23 ||
      (minute ?? 0) > 59 ||
      (second ?? 0) > 59
    ) {
      return invalid();
    }
    const parsed = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    instant = Number.isNaN(parsed.getTime()) ? null : parsed;
  } else {
    const iso = ISO_LOCAL.exec(value);
    const dmy = iso ? null : DAY_FIRST.exec(value);
    const parts = iso
      ? { y: iso[1], m: iso[2], d: iso[3], h: iso[4], mi: iso[5], s: iso[6] }
      : dmy
        ? { y: dmy[3], m: dmy[2], d: dmy[1], h: dmy[4], mi: dmy[5], s: dmy[6] }
        : null;
    if (!parts) return invalid();
    const year = Number(parts.y);
    const month = Number(parts.m);
    const day = Number(parts.d);
    const hour = parts.h === undefined ? DEFAULT_HOUR : Number(parts.h);
    const minute = parts.mi === undefined ? 0 : Number(parts.mi);
    const second = parts.s === undefined ? 0 : Number(parts.s);
    if (!realDay(year, month, day) || hour > 23 || minute > 59 || second > 59) {
      return invalid();
    }
    instant = parseLocalInput(
      `${parts.y}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`,
    );
  }
  if (instant === null) return invalid();

  const problem = dateRangeError(instant, now);
  if (problem !== null) {
    return fail(
      "INVALID_DATE",
      problem === "La fecha no puede ser futura"
        ? `Fecha «${shown(value)}»: es futura. Revisá que el día y el mes no estén al revés`
        : `Fecha «${shown(value)}»: ${problem.toLowerCase()}`,
    );
  }
  return ok(instant);
}

// --- Campos ---------------------------------------------------------------------------------------

function parseType(text: string | undefined): Parsed<TxType> {
  if (text === undefined) {
    return fail("INVALID_TYPE", `Tipo: falta el dato. Usá ${TYPE_HINT}`);
  }
  const type = TYPE_WORDS.get(normalizeHeader(text));
  return type === undefined
    ? fail(
        "INVALID_TYPE",
        `Tipo «${shown(text)}»: no lo reconocemos. Usá ${TYPE_HINT}`,
      )
    : ok(type);
}

function parseSymbol(text: string | undefined): Parsed<string> {
  if (text === undefined)
    return fail("INVALID_SYMBOL", "Símbolo: falta el dato");
  const symbol = normalizeSymbol(text);
  if (symbol.length > 15 || !SYMBOL_PATTERN.test(symbol)) {
    return fail(
      "INVALID_SYMBOL",
      `Símbolo «${shown(text)}»: no es válido. Usá el ticker, por ejemplo VOO o BRK-B`,
    );
  }
  return ok(symbol);
}

function requiredNumber(
  label: string,
  code: Code,
  text: string | undefined,
  rules: DecimalRules,
): Parsed<Dec> {
  if (text === undefined) return fail(code, `${label}: falta el dato`);
  const parsed = parseDecimalText(text, rules);
  return parsed.ok
    ? ok(parsed.value)
    : fail(code, `${label} «${shown(text)}»: ${parsed.message}`);
}

function optionalNumber(
  label: string,
  code: Code,
  text: string | undefined,
  rules: DecimalRules,
): Parsed<Dec | null> {
  if (text === undefined) return ok(null);
  return requiredNumber(label, code, text, rules);
}

/** El export antepone `'` a las notas que empiezan como una fórmula: al leerlas se lo quitamos. */
const NEUTRALIZED = /^'(?=[=+\-@\t\r])/;

function parseNotes(text: string | undefined): Parsed<string | null> {
  if (text === undefined) return ok(null);
  const cleaned = cleanText(text.replace(NEUTRALIZED, ""), 2000);
  if (cleaned !== null && cleaned.length > MAX_NOTES) {
    return fail("INVALID_ROW", `Notas: máximo ${MAX_NOTES} caracteres`);
  }
  return ok(cleaned);
}

// --- Archivo --------------------------------------------------------------------------------------

/** Lo que llevan todos los borradores, sea cual sea el tipo. */
interface Common {
  executedAt: Date;
  currency: string;
  notes: string | null;
  source: "csv";
  externalId: string;
  sourceRow: number;
}

interface Accumulator {
  transactions: TransactionDraft[];
  skipped: SkippedRow[];
  errors: RowError[];
  symbols: Set<string>;
  keyCounts: Map<string, number>;
}

export function parseSimpleCsv(text: string, now: Date): ImportParseResult {
  const input = stripBom(text);
  if (input.trim() === "") {
    return failure({ code: "EMPTY_FILE", message: "El archivo está vacío" });
  }

  const parsed = Papa.parse<RawRow>(input, {
    header: true,
    // Las filas vacías se saltean a mano (no acá): así el número de fila es el de la planilla.
    skipEmptyLines: false,
    delimitersToGuess: DELIMITERS,
    transformHeader: normalizeHeader,
  });

  const fields = parsed.meta.fields ?? [];
  const columns = resolveColumns(fields);
  const missing = [
    columns.date === undefined ? "fecha" : null,
    columns.type === undefined ? "tipo" : null,
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    return failure({
      code: "MISSING_COLUMNS",
      message: `Faltan columnas: ${missing.join(", ")}. Encontramos: ${describeFields(fields)}.`,
    });
  }

  // Filas mal formadas por índice de dato. Con menos campos que el encabezado se sigue: los datos
  // que falten los reclama el chequeo de cada campo, con su nombre. Con más campos no: las columnas
  // se corren y un número podría quedar en la columna equivocada.
  const malformed = new Map<number, string>();
  for (const error of parsed.errors) {
    if (error.row === undefined || malformed.has(error.row)) continue;
    const message = MALFORMED_MESSAGES[error.code];
    if (message !== undefined) malformed.set(error.row, message);
  }

  const acc: Accumulator = {
    transactions: [],
    skipped: [],
    errors: [],
    symbols: new Set(),
    keyCounts: new Map(),
  };

  let rowsTotal = 0;
  parsed.data.forEach((raw, index) => {
    const row = index + 2; // fila del archivo: el encabezado es la 1
    const blank = Object.values(raw).every(
      (cell) => typeof cell !== "string" || cell.trim() === "",
    );
    if (blank) return;
    rowsTotal += 1;
    const problem = malformed.get(index);
    if (problem !== undefined) {
      acc.errors.push({ row, code: "MALFORMED_ROW", message: problem });
      return;
    }
    processRow(row, raw, columns, now, acc);
  });

  // Estable: las operaciones del mismo instante (todas las de un día sin hora) conservan el orden
  // del archivo.
  const transactions = [...acc.transactions].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
  );
  const instruments: InstrumentInfo[] = [...acc.symbols].map((symbol) => ({
    symbol,
    name: null,
    type: "STOCK",
  }));

  return {
    transactions,
    skipped: acc.skipped,
    errors: acc.errors,
    instruments,
    stats: {
      rowsTotal,
      imported: transactions.length,
      skipped: acc.skipped.length,
      errors: acc.errors.length,
    },
    fatal: null,
  };
}

function processRow(
  row: number,
  raw: RawRow,
  columns: ColumnMap,
  now: Date,
  acc: Accumulator,
): void {
  const type = parseType(valueOf(raw, columns.type));
  if (!type.ok) {
    acc.errors.push({ row, code: type.code, message: type.message });
    return;
  }

  const currencyText = valueOf(raw, columns.currency);
  if (
    currencyText !== undefined &&
    currencyCode(currencyText) !== SUPPORTED_CURRENCY
  ) {
    acc.skipped.push({
      row,
      reason: "UNSUPPORTED_CURRENCY",
      detail: `Moneda ${currencyCode(currencyText)} no soportada (solo ${SUPPORTED_CURRENCY})`,
    });
    return;
  }

  // Se revisan todos los campos de la fila antes de rendirse, para mostrar todos los problemas
  // juntos y que arreglarlos no lleve una vuelta por cada uno.
  const problems: Array<{ code: Code; message: string }> = [];
  const take = <T>(result: Parsed<T>): T | undefined => {
    if (result.ok) return result.value;
    problems.push({ code: result.code, message: result.message });
    return undefined;
  };

  const dateText = valueOf(raw, columns.date);
  const executedAt = take(
    dateText === undefined
      ? fail("INVALID_DATE", `Fecha: falta el dato. ${DATE_HINT}`)
      : parseImportDate(dateText, now),
  );
  const notes = take(parseNotes(valueOf(raw, columns.notes)));

  const symbolText = valueOf(raw, columns.symbol);
  const num = (column: Field) => valueOf(raw, columns[column]);

  // Cada tipo arma su borrador cuando ya están todos los campos; `key` identifica la operación.
  let build: ((common: Common) => TransactionDraft) | null = null;
  let key = "";

  switch (type.value) {
    case "BUY":
    case "SELL": {
      const symbol = take(parseSymbol(symbolText));
      const quantity = take(
        requiredNumber(
          "Cantidad",
          "INVALID_QUANTITY",
          num("quantity"),
          QUANTITY,
        ),
      );
      const price = take(
        requiredNumber("Precio", "INVALID_PRICE", num("price"), PRICE),
      );
      const fee = take(
        optionalNumber("Comisión", "INVALID_FEE", num("fee"), FEE),
      );
      if (
        symbol !== undefined &&
        quantity !== undefined &&
        price !== undefined &&
        fee !== undefined
      ) {
        const feeValue = fee ?? ZERO;
        const tradeType = type.value;
        build = (common) => ({
          ...common,
          type: tradeType,
          symbol,
          quantity,
          price,
          fee: feeValue,
        });
        key = `${tradeType}|${symbol}|${quantity.toFixed()}|${price.toFixed()}|${feeValue.toFixed()}`;
      }
      break;
    }
    case "DIVIDEND": {
      const symbol = take(parseSymbol(symbolText));
      const amount = take(
        requiredNumber("Monto", "INVALID_AMOUNT", num("amount"), AMOUNT),
      );
      if (symbol !== undefined && amount !== undefined) {
        build = (common) => ({ ...common, type: "DIVIDEND", symbol, amount });
        key = `DIVIDEND|${symbol}|${amount.toFixed()}`;
      }
      break;
    }
    case "SPLIT": {
      const symbol = take(parseSymbol(symbolText));
      const splitRatio = take(
        requiredNumber(
          "Razón del split",
          "INVALID_SPLIT",
          num("splitRatio"),
          SPLIT_RATIO,
        ),
      );
      if (splitRatio?.eq(1)) {
        take(
          fail(
            "INVALID_SPLIT",
            "Razón del split: un split 1 por 1 no cambia nada",
          ),
        );
      } else if (symbol !== undefined && splitRatio !== undefined) {
        build = (common) => ({ ...common, type: "SPLIT", symbol, splitRatio });
        key = `SPLIT|${symbol}|${splitRatio.toFixed()}`;
      }
      break;
    }
    case "INTEREST": {
      const amount = take(
        requiredNumber("Monto", "INVALID_AMOUNT", num("amount"), SIGNED_AMOUNT),
      );
      if (amount !== undefined) {
        build = (common) => ({
          ...common,
          type: "INTEREST",
          symbol: null,
          amount,
        });
        key = `INTEREST||${amount.toFixed()}`;
      }
      break;
    }
    case "DEPOSIT":
    case "WITHDRAWAL":
    case "FEE":
    case "TAX": {
      const amount = take(
        requiredNumber("Monto", "INVALID_AMOUNT", num("amount"), AMOUNT),
      );
      if (amount !== undefined) {
        const cashType = type.value;
        build = (common) => ({
          ...common,
          type: cashType,
          symbol: null,
          amount,
        });
        key = `${cashType}||${amount.toFixed()}`;
      }
      break;
    }
  }

  if (problems.length > 0 || build === null || executedAt === undefined) {
    for (const problem of problems) acc.errors.push({ row, ...problem });
    return;
  }

  const draft = build({
    executedAt,
    currency: SUPPORTED_CURRENCY,
    notes: notes ?? null,
    source: "csv",
    externalId: externalId(acc, executedAt, key),
    sourceRow: row,
  });
  acc.transactions.push(draft);
  if ("symbol" in draft && draft.symbol !== null) acc.symbols.add(draft.symbol);
}

/**
 * Clave de deduplicación: instante + tipo + símbolo + cantidades, con los decimales en forma
 * canónica. Las filas idénticas del mismo archivo llevan sufijo `#2`, `#3`…: sin él, dos
 * ejecuciones iguales colapsarían por la restricción unique.
 */
function externalId(acc: Accumulator, executedAt: Date, key: string): string {
  const full = `csv:${executedAt.toISOString()}|${key}`;
  const seen = (acc.keyCounts.get(full) ?? 0) + 1;
  acc.keyCounts.set(full, seen);
  return seen === 1 ? full : `${full}#${seen}`;
}

/** Los encabezados encontrados, para mostrarlos en un mensaje sin desbordarlo. */
export function describeFields(fields: readonly string[]): string {
  const names = fields
    .map((field) => cleanText(field, 24))
    .filter((field): field is string => field !== null);
  if (names.length === 0) return "ninguna";
  const head = names.slice(0, 8).join(", ");
  return names.length > 8 ? `${head}…` : head;
}

const MALFORMED_MESSAGES: Partial<Record<string, string>> = {
  TooManyFields:
    "La fila tiene más columnas que el encabezado. Si un número usa coma decimal y el archivo se separa con comas, escribilo con punto (575.24) o entre comillas",
  MissingQuotes: "Comillas sin cerrar",
  InvalidQuotes: "Comillas mal cerradas",
};
