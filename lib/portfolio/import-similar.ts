import type { Transaction } from "@/lib/engine";
import type { TransactionDraft } from "@/lib/importers";
import { localDateKey } from "./time";

// «Parecidas a lo que ya tenés»: lo cargado a mano y lo que viene en un CSV no comparten
// identificador, así que subir el CSV que incluye compras ya cargadas a mano las duplicaría (el
// costo base y las posiciones saldrían dobles). La deduplicación exacta (`external_id`) no las ve;
// esto sí: dos operaciones son parecidas si caen el mismo día (hora de Montevideo), son del mismo
// tipo y símbolo y tienen la misma cantidad (o el mismo monto o razón). El precio no cuenta:
// tipearlo a mano rara vez da el mismo decimal. Puro.

type Comparable = Pick<Transaction, "type" | "executedAt"> &
  Partial<{
    symbol: string | null;
    quantity: { toFixed(): string };
    amount: { toFixed(): string };
    splitRatio: { toFixed(): string };
  }>;

/** La identidad «suave» de una operación. */
export function similarityKey(tx: Comparable): string {
  const size =
    tx.quantity?.toFixed() ??
    tx.amount?.toFixed() ??
    tx.splitRatio?.toFixed() ??
    "";
  return `${localDateKey(tx.executedAt)}|${tx.type}|${tx.symbol ?? ""}|${size}`;
}

/**
 * Cuáles de `drafts` parecen repetir algo de `existing`. Cuenta las repeticiones: con dos idénticas
 * en el archivo y una sola ya cargada, se marca una (la otra es una operación distinta).
 */
export function findSimilar(
  drafts: readonly TransactionDraft[],
  existing: readonly Transaction[],
): Set<TransactionDraft> {
  const available = new Map<string, number>();
  for (const tx of existing) {
    const key = similarityKey(tx);
    available.set(key, (available.get(key) ?? 0) + 1);
  }

  const similar = new Set<TransactionDraft>();
  for (const draft of drafts) {
    const key = similarityKey(draft);
    const left = available.get(key) ?? 0;
    if (left > 0) {
      available.set(key, left - 1);
      similar.add(draft);
    }
  }
  return similar;
}
