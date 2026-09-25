import Papa from "papaparse";
import { parseDeltaCsv, stripBom } from "./delta";
import { failure } from "./failure";
import {
  describeFields,
  normalizeHeader,
  parseSimpleCsv,
  resolveColumns,
} from "./simple";
import { flagTemplateRows } from "./template";
import type { ImportFormat, ImportParseResult, ImportSource } from "./types";

// Reconoce el formato de un CSV por sus encabezados y lo lee con el importador que corresponde. La
// pantalla de importación usa solo esto: la persona no tiene que elegir el formato.

export const FORMAT_SOURCE: Record<ImportFormat, ImportSource> = {
  delta: "delta_csv",
  simple: "csv",
};

export const FORMAT_LABELS: Record<ImportFormat, string> = {
  delta: "Delta",
  simple: "Portfolio Tracker",
};

export interface DetectedImport {
  /** `null` si no se reconoció ninguno (el resultado trae `fatal`). */
  format: ImportFormat | null;
  result: ImportParseResult;
}

// Columnas que solo tiene un export de Delta: si están, el archivo es de Delta aunque le falten otras.
const DELTA_HINTS = new Set([
  "way",
  "base_amount",
  "quote_amount",
  "base_type",
]);

function sniffHeaders(text: string): string[] {
  const first = Papa.parse<string[]>(text, {
    header: false,
    preview: 1,
    skipEmptyLines: true,
    delimitersToGuess: [",", ";", "\t"],
  });
  return (first.data[0] ?? []).map((header) => header.trim());
}

export function parseImport(text: string, now: Date): DetectedImport {
  const input = stripBom(text);
  if (input.trim() === "") {
    return {
      format: null,
      result: failure({ code: "EMPTY_FILE", message: "El archivo está vacío" }),
    };
  }

  const headers = sniffHeaders(input);
  if (headers.includes("Way") && headers.includes("Base amount")) {
    return { format: "delta", result: parseDeltaCsv(input) };
  }

  const columns = resolveColumns(headers);
  if (columns.date !== undefined && columns.type !== undefined) {
    return {
      format: "simple",
      result: flagTemplateRows(parseSimpleCsv(input, now)),
    };
  }

  if (headers.some((header) => DELTA_HINTS.has(normalizeHeader(header)))) {
    // Parece de Delta pero incompleto: el mensaje dice qué columnas faltan.
    return { format: "delta", result: parseDeltaCsv(input) };
  }

  return {
    format: null,
    result: failure({
      code: "UNKNOWN_FORMAT",
      message: `No reconocemos las columnas del archivo (encontramos: ${describeFields(headers)}). Necesitamos al menos «fecha» y «tipo»: bajá la plantilla para ver el formato, o subí el export de Delta.`,
    }),
  };
}
