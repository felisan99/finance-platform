import { D, cashDelta, type Dec } from "@/lib/engine";
import { TRANSACTION_TYPE_LABELS } from "@/lib/validation/transaction";
import { formatMoney, formatPrice, formatQuantity } from "./format";
import { rowToTransaction } from "./mappers";
import type { TransactionRow, TxTypeName } from "./rows";

/** Una fila de la lista de Actividad, ya resuelta para mostrar. */
export interface TxView {
  id: string;
  type: TxTypeName;
  typeLabel: string;
  symbol: string | null;
  /** Segunda línea: cantidad y precio, razón del split o notas. */
  detail: string;
  /** Efecto sobre el efectivo (compra negativa, venta y dividendo positivos). */
  cash: Dec;
  executedAt: Date;
  source: string;
  /** De qué portafolio es (solo al mirar varios juntos). */
  portfolioName?: string | null;
}

const trim = (value: Dec) => formatQuantity(value);

/** `10 por 1` para 10:1; `1 por 10` para un split inverso 1:10. */
export function formatSplitRatio(ratio: Dec): string {
  if (ratio.gte(1)) return `${trim(ratio)} por 1`;
  return `1 por ${trim(new D(1).div(ratio).toDecimalPlaces(4))}`;
}

/** Arma lo que muestra la lista para una fila de `transactions`. */
export function describeTransaction(
  row: TransactionRow,
  accountId: string,
  symbolById: ReadonlyMap<string, string>,
): TxView {
  const tx = rowToTransaction(row, accountId, symbolById);
  let detail = "";
  switch (tx.type) {
    case "BUY":
    case "SELL":
      detail = `${formatQuantity(tx.quantity)} × ${formatPrice(tx.price)}`;
      if (!tx.fee.isZero()) detail += ` · comisión ${formatMoney(tx.fee)}`;
      break;
    case "SPLIT":
      detail = formatSplitRatio(tx.splitRatio);
      break;
    default:
      detail = tx.notes ?? "";
  }
  return {
    id: row.id,
    type: tx.type,
    typeLabel: TRANSACTION_TYPE_LABELS[tx.type],
    symbol:
      tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL" ? null : tx.symbol,
    detail,
    cash: cashDelta(tx),
    executedAt: tx.executedAt,
    source: row.source,
  };
}
