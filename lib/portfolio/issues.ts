import type { EngineIssue } from "@/lib/engine";

/**
 * Un problema del libro mayor en español, para mostrárselo a la persona. `rowOf` traduce el id de
 * una transacción al número de fila del archivo (en las importaciones).
 */
export function describeIssue(
  issue: EngineIssue,
  rowOf?: ReadonlyMap<string, number>,
): string {
  const row = "txId" in issue ? rowOf?.get(issue.txId) : undefined;
  const where = row === undefined ? "" : ` (fila ${row} del archivo)`;
  switch (issue.code) {
    case "SELL_EXCEEDS_HOLDINGS":
      return `Vende ${issue.requested.toFixed()} ${issue.symbol} pero solo hay ${issue.available.toFixed()} disponibles${where}`;
    case "INVALID_TRANSACTION":
    case "UNSUPPORTED_CURRENCY":
      return `${issue.message}${where}`;
    case "SPLIT_WITHOUT_POSITION":
      return `Split de ${issue.symbol} sin tener la posición${where}`;
    case "NEGATIVE_CASH":
      return `El efectivo queda negativo (${issue.cash.toFixed()} USD): probablemente falta cargar un depósito`;
  }
}

/** Mensaje para un cambio (alta, edición o baja) que el libro no admite. */
export function describeRejectedChange(issues: readonly EngineIssue[]): string {
  const first = issues[0];
  if (!first) return "El cambio deja el registro inconsistente";
  const more =
    issues.length > 1
      ? ` (y ${issues.length - 1} problema${issues.length === 2 ? "" : "s"} más)`
      : "";
  return `Ese cambio deja el registro inconsistente: ${describeIssue(first)}${more}.`;
}
