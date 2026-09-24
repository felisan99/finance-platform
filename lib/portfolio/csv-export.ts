import { d } from "@/lib/engine";
import { formatLocal } from "./time";
import type { TransactionRow } from "./rows";

// Exportación de las transacciones a CSV (spec §10.3: backup). El CSV lo va a abrir alguien en una
// planilla: una celda de TEXTO que empiece con `=`, `+`, `-`, `@`, tabulación o retorno se
// interpreta como fórmula (CSV injection), así que se le antepone una comilla simple. Las columnas
// numéricas no lo necesitan (y un `-5,00` no debe alterarse); salen de columnas `numeric`.

export const CSV_COLUMNS = [
  "fecha_utc",
  "fecha_montevideo",
  "tipo",
  "simbolo",
  "cantidad",
  "precio",
  "monto",
  "comision",
  "razon_split",
  "moneda",
  "notas",
  "origen",
  "id_externo",
] as const;

// Con `fromCharCode`: un escape en el código lo convierte Prettier en un carácter invisible.
const BOM = String.fromCharCode(0xfeff);

const FORMULA_START = /^[=+\-@\t\r]/;

/** Celda de texto: neutraliza fórmulas y aplica el entrecomillado de CSV (RFC 4180). */
export function csvText(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) || safe !== safe.trim()
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

/** Celda numérica: decimal canónico sin ceros de relleno (`8.9500000` → `8.95`). */
function csvNumber(value: string | null): string {
  return value === null ? "" : d(value).toFixed();
}

export function buildTransactionsCsv(
  rows: readonly TransactionRow[],
  symbolById: ReadonlyMap<string, string>,
): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const at = new Date(row.executed_at);
    lines.push(
      [
        at.toISOString(),
        formatLocal(at, "yyyy-MM-dd HH:mm:ss"),
        row.type,
        csvText(
          row.instrument_id ? (symbolById.get(row.instrument_id) ?? "") : "",
        ),
        csvNumber(row.quantity),
        csvNumber(row.price),
        csvNumber(row.amount),
        csvNumber(row.fee),
        csvNumber(row.split_ratio),
        csvText(row.currency),
        csvText(row.notes),
        csvText(row.source),
        csvText(row.external_id),
      ].join(","),
    );
  }
  // BOM: sin ella Excel abre el CSV en la codificación del sistema y rompe las tildes.
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
