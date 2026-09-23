import type { Transaction } from "@/lib/engine";
import type { TransactionDraft } from "./types";

/**
 * Arma las `Transaction` del motor a partir de los borradores del importador (por ejemplo
 * para calcular la vista previa antes de insertar). El `id` es el `externalId`; todos
 * comparten `createdAt`, así que los empates de fecha conservan el orden del archivo.
 */
export function toEngineTransactions(
  drafts: readonly TransactionDraft[],
  ctx: { accountId: string; importedAt: Date },
): Transaction[] {
  return drafts.map((draft): Transaction => {
    const base = {
      id: draft.externalId,
      accountId: ctx.accountId,
      executedAt: draft.executedAt,
      createdAt: ctx.importedAt,
      currency: draft.currency,
      notes: draft.notes,
    };
    switch (draft.type) {
      case "BUY":
      case "SELL":
        return {
          ...base,
          type: draft.type,
          symbol: draft.symbol,
          quantity: draft.quantity,
          price: draft.price,
          fee: draft.fee,
        };
      case "DIVIDEND":
        return {
          ...base,
          type: "DIVIDEND",
          symbol: draft.symbol,
          amount: draft.amount,
        };
      case "SPLIT":
        return {
          ...base,
          type: "SPLIT",
          symbol: draft.symbol,
          splitRatio: draft.splitRatio,
        };
      case "DEPOSIT":
      case "WITHDRAWAL":
      case "INTEREST":
      case "FEE":
      case "TAX":
        return {
          ...base,
          type: draft.type,
          symbol: draft.symbol,
          amount: draft.amount,
        };
    }
  });
}
