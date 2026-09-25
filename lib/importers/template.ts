import { parseSimpleCsv } from "./simple";
import type { ImportParseResult, TransactionDraft } from "./types";

// Plantilla descargable del formato simple. Es la documentación que se puede abrir en una planilla:
// el encabezado y unas filas de ejemplo (un depósito, compras con y sin fracción, una venta y un
// dividendo). Si alguien sube la plantilla sin tocar, o deja las filas de ejemplo mezcladas con las
// suyas, `flagTemplateRows` las rechaza: no deben terminar en un portafolio real.

export const TEMPLATE_FILENAME = "plantilla-portfolio-tracker.csv";
const EXAMPLE_NOTE = "Ejemplo: borrá esta fila";

const HEADER = [
  "fecha",
  "tipo",
  "simbolo",
  "cantidad",
  "precio",
  "monto",
  "comision",
  "notas",
] as const;

// Sin comas ni comillas en las celdas: no hace falta entrecomillar nada.
const EXAMPLE_ROWS: ReadonlyArray<readonly string[]> = [
  ["2025-01-02", "deposito", "", "", "", "1000", "", EXAMPLE_NOTE],
  ["2025-01-03", "compra", "VOO", "2", "400.50", "", "1", EXAMPLE_NOTE],
  [
    "2025-01-06",
    "compra",
    "AAPL",
    "0.5",
    "75.25",
    "",
    "",
    "Ejemplo con cantidad fraccionaria: borrá esta fila",
  ],
  ["2025-02-10", "venta", "VOO", "1", "410", "", "1", EXAMPLE_NOTE],
  ["2025-03-14", "dividendo", "VOO", "", "", "1.15", "", EXAMPLE_NOTE],
];

// Con `fromCharCode`: un escape en el código lo convierte Prettier en un carácter invisible.
const BOM = String.fromCharCode(0xfeff);

/** El CSV de la plantilla: BOM (Excel respeta las tildes) y CRLF. */
export function buildImportTemplate(): string {
  const lines = [HEADER, ...EXAMPLE_ROWS].map((cells) => cells.join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** Sin el sufijo `#n` de las filas repetidas. */
const baseId = (externalId: string) => externalId.replace(/#\d+$/, "");

let cachedKeys: ReadonlySet<string> | null = null;

/** Claves de deduplicación de las filas de ejemplo (calculadas con el propio parser, una vez). */
function templateKeys(): ReadonlySet<string> {
  if (cachedKeys === null) {
    const parsed = parseSimpleCsv(
      buildImportTemplate(),
      new Date("2025-12-31T00:00:00Z"),
    );
    cachedKeys = new Set(parsed.transactions.map((t) => baseId(t.externalId)));
  }
  return cachedKeys;
}

const TEMPLATE_ROW_MESSAGE =
  "Es una fila de ejemplo de la plantilla: borrala o reemplazala por una operación tuya";

/**
 * Pasa a errores las filas que son un ejemplo de la plantilla tal cual. Compara por la clave de
 * deduplicación (instante, tipo, símbolo, cantidades): un dato cambiado ya es otra operación.
 */
export function flagTemplateRows(result: ImportParseResult): ImportParseResult {
  if (result.fatal) return result;
  const keys = templateKeys();
  const kept: TransactionDraft[] = [];
  const errors = [...result.errors];
  for (const tx of result.transactions) {
    if (keys.has(baseId(tx.externalId))) {
      errors.push({
        row: tx.sourceRow,
        code: "TEMPLATE_ROW",
        message: TEMPLATE_ROW_MESSAGE,
      });
    } else {
      kept.push(tx);
    }
  }
  if (kept.length === result.transactions.length) return result;

  errors.sort((a, b) => a.row - b.row);
  const symbols = new Set(
    kept.flatMap((tx) => ("symbol" in tx && tx.symbol ? [tx.symbol] : [])),
  );
  return {
    ...result,
    transactions: kept,
    errors,
    instruments: result.instruments.filter((i) => symbols.has(i.symbol)),
    stats: { ...result.stats, imported: kept.length, errors: errors.length },
  };
}
