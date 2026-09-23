interface Chronological {
  executedAt: Date;
  createdAt: Date;
}

/**
 * Orden cronológico `(executedAt, createdAt)`. Los empates completos conservan el
 * orden de entrada (Array.prototype.sort es estable). No muta el arreglo recibido.
 */
export function sortTransactions<T extends Chronological>(
  txs: readonly T[],
): T[] {
  return [...txs].sort(
    (a, b) =>
      a.executedAt.getTime() - b.executedAt.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}
