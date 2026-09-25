import type { FatalError, ImportParseResult } from "./types";

/** Resultado de un archivo que no se puede procesar entero: no hay filas, solo el motivo. */
export function failure(fatal: FatalError): ImportParseResult {
  return {
    transactions: [],
    skipped: [],
    errors: [],
    instruments: [],
    stats: { rowsTotal: 0, imported: 0, skipped: 0, errors: 0 },
    fatal,
  };
}
