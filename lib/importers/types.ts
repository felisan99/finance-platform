import type { Transaction } from "@/lib/engine";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type ImportSource = "delta_csv" | "ibkr_flex";

/**
 * Transacción lista para insertar, sin los campos que asigna la capa de base de datos
 * (`id`, `accountId`, `createdAt`). `externalId` deduplica reimportaciones.
 */
export type TransactionDraft = DistributiveOmit<
  Transaction,
  "id" | "accountId" | "createdAt"
> & {
  source: ImportSource;
  externalId: string;
  /** Número de fila del archivo (el encabezado es la fila 1), para la vista previa. */
  sourceRow: number;
};

export interface InstrumentInfo {
  symbol: string;
  name: string | null;
  type: "STOCK" | "ETF";
}

export type SkipReason =
  | "SYNC_BASE_HOLDINGS_LEG"
  | "UNSUPPORTED_WAY"
  | "UNSUPPORTED_ASSET_TYPE"
  | "UNSUPPORTED_CURRENCY";

/** Fila válida que el importador no maneja: se muestra en la vista previa con su motivo. */
export interface SkippedRow {
  row: number;
  reason: SkipReason;
  detail: string;
}

/** Fila mal formada: no se importa. */
export interface RowError {
  row: number;
  code:
    | "MALFORMED_ROW"
    | "INVALID_ROW"
    | "INVALID_SYMBOL"
    | "INVALID_QUANTITY"
    | "INVALID_AMOUNT";
  message: string;
}

/** Problema del archivo entero: no se procesa ninguna fila. */
export interface FatalError {
  code: "EMPTY_FILE" | "MISSING_COLUMNS";
  message: string;
}

export interface ParseStats {
  rowsTotal: number;
  imported: number;
  skipped: number;
  errors: number;
}

export interface ImportParseResult {
  /** Ordenadas por fecha (estable: los empates conservan el orden del archivo). */
  transactions: TransactionDraft[];
  skipped: SkippedRow[];
  errors: RowError[];
  /** Instrumentos de las operaciones importadas, para crearlos si no existen. */
  instruments: InstrumentInfo[];
  stats: ParseStats;
  fatal: FatalError | null;
}
