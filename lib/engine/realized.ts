import { marketDay } from "./dates";
import { ZERO, type Dec } from "./decimal";
import { applyTransaction, createLedger } from "./engine";
import { sortTransactions } from "./ordering";
import type { EngineOptions, Transaction } from "./types";

// Ganancia realizada venta por venta (costo promedio, spec §6.1). `Position.realizedPnl` es el
// acumulado histórico; para responder "cuánto realicé en tal período" hace falta saber cuándo se
// realizó cada parte. Puro.

export interface RealizedEvent {
  /** Día de mercado de la venta (YYYY-MM-DD, hora de Nueva York), como la serie diaria. */
  date: string;
  symbol: string;
  txId: string;
  quantity: Dec;
  /** Cantidad × precio − comisión. */
  proceeds: Dec;
  /** Costo base que salió con la venta. */
  costOut: Dec;
  /** `proceeds − costOut`. */
  realized: Dec;
}

/**
 * Recorre el libro de UNA cuenta y devuelve una entrada por cada venta aceptada por el motor
 * (una venta que excede la tenencia no realiza nada). Con «Todo junto» se llama por cuenta y se
 * concatenan: cada venta pertenece a una sola cuenta, así que no hay nada que recalcular.
 */
export function realizedEvents(
  txs: readonly Transaction[],
  options: EngineOptions = {},
): RealizedEvent[] {
  let ledger = createLedger();
  const events: RealizedEvent[] = [];
  for (const tx of sortTransactions(txs)) {
    const before = tx.type === "SELL" ? ledger.positions.get(tx.symbol) : null;
    const issuesBefore = ledger.issues.length;
    ledger = applyTransaction(ledger, tx, options);
    if (tx.type !== "SELL" || ledger.issues.length !== issuesBefore) continue;

    const after = ledger.positions.get(tx.symbol);
    const realizedBefore = before?.realizedPnl ?? ZERO;
    const realized = (after?.realizedPnl ?? ZERO).minus(realizedBefore);
    const proceeds = tx.quantity.mul(tx.price).minus(tx.fee);
    events.push({
      date: marketDay(tx.executedAt),
      symbol: tx.symbol,
      txId: tx.id,
      quantity: tx.quantity,
      proceeds,
      costOut: proceeds.minus(realized),
      realized,
    });
  }
  return events;
}

export interface RealizedBySymbol {
  symbol: string;
  realized: Dec;
  sales: number;
}

export interface RealizedSummary {
  /** Ordenado de mayor ganancia a mayor pérdida (empate: por símbolo). */
  bySymbol: RealizedBySymbol[];
  total: Dec;
  sales: number;
}

/** Suma las ventas con fecha en `[from, to]` (ambos inclusive; `null` = sin límite). */
export function summarizeRealized(
  events: readonly RealizedEvent[],
  from: string | null,
  to: string | null,
): RealizedSummary {
  const bySymbol = new Map<string, RealizedBySymbol>();
  for (const event of events) {
    if (from !== null && event.date < from) continue;
    if (to !== null && event.date > to) continue;
    const current = bySymbol.get(event.symbol) ?? {
      symbol: event.symbol,
      realized: ZERO,
      sales: 0,
    };
    bySymbol.set(event.symbol, {
      symbol: event.symbol,
      realized: current.realized.plus(event.realized),
      sales: current.sales + 1,
    });
  }
  const rows = [...bySymbol.values()].sort((a, b) => {
    const byValue = b.realized.comparedTo(a.realized);
    return byValue !== 0 ? byValue : a.symbol < b.symbol ? -1 : 1;
  });
  return {
    bySymbol: rows,
    total: rows.reduce((acc, row) => acc.plus(row.realized), ZERO),
    sales: rows.reduce((acc, row) => acc + row.sales, 0),
  };
}
