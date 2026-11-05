import { addDays, marketDay } from "./dates";
import { QTY_EPSILON, ZERO, type Dec } from "./decimal";
import { applyTransaction, createLedger } from "./engine";
import { sortTransactions } from "./ordering";
import type { EngineOptions, Transaction } from "./types";

// Splits que el libro de una cuenta debería tener y no tiene. Puro.
//
// Los precios guardados ya vienen ajustados por el split y el motor solo aplica los `SPLIT` del
// libro: si falta, la cantidad no cambia pero el precio sí, y la posición muestra una pérdida que
// no existe (SOXX 3:1, 2026-11-05). Se agregan solos (`lib/portfolio/auto-splits.ts`) a toda cuenta
// que tenía el activo al cierre del día anterior al ex-split.

export interface SplitEvent {
  /** El id de `corporate_actions`. */
  id: string;
  symbol: string;
  /** Primer día en que el activo cotiza con la razón nueva (YYYY-MM-DD). */
  exDate: string;
  /** Nuevas por cada vieja: 3 para un 3:1, 0.1 para un 1:10. */
  ratio: Dec;
}

export interface MissingSplit {
  eventId: string;
  symbol: string;
  exDate: string;
  ratio: Dec;
  /** Acciones al cierre del día anterior al ex-split. */
  shares: Dec;
}

export interface SplitInput {
  /** Transacciones de UNA cuenta. */
  transactions: readonly Transaction[];
  events: readonly SplitEvent[];
  /** Ids de `corporate_actions` que la persona borró en esta cuenta: no se vuelven a agregar. */
  dismissed: ReadonlySet<string>;
  /** Día de mercado de hoy: los splits futuros todavía no se agregan. */
  today: string;
  options?: EngineOptions;
}

/**
 * Días alrededor del ex-split en los que un `SPLIT` del mismo símbolo ya cargado (a mano, importado
 * o automático) se toma como ese mismo split, aunque tenga otra fecha o razón: agregar otro lo
 * aplicaría dos veces.
 */
export const SPLIT_RECORDED_BEFORE_DAYS = 7;
export const SPLIT_RECORDED_AFTER_DAYS = 60;

export function missingSplits(input: SplitInput): MissingSplit[] {
  const txs = sortTransactions(input.transactions).map((tx) => ({
    tx,
    day: marketDay(tx.executedAt),
  }));
  const recorded = txs.filter(({ tx }) => tx.type === "SPLIT");

  const missing: MissingSplit[] = [];
  for (const event of input.events) {
    if (event.exDate > input.today) continue;
    if (!event.ratio.gt(0) || event.ratio.eq(1)) continue;
    if (input.dismissed.has(event.id)) continue;
    const alreadyRecorded = recorded.some(
      ({ tx, day }) =>
        tx.symbol === event.symbol &&
        day >= addDays(event.exDate, -SPLIT_RECORDED_BEFORE_DAYS) &&
        day <= addDays(event.exDate, SPLIT_RECORDED_AFTER_DAYS),
    );
    if (alreadyRecorded) continue;

    // El libro al cierre del día anterior al ex-split (con los splits anteriores ya aplicados).
    let ledger = createLedger();
    for (const { tx, day } of txs) {
      if (day >= event.exDate) break;
      ledger = applyTransaction(ledger, tx, input.options);
    }
    const shares = ledger.positions.get(event.symbol)?.quantity ?? ZERO;
    if (shares.lt(QTY_EPSILON)) continue;

    missing.push({
      eventId: event.id,
      symbol: event.symbol,
      exDate: event.exDate,
      ratio: event.ratio,
      shares,
    });
  }

  // Del más viejo al más nuevo: así se agregan en orden.
  return missing.sort((a, b) =>
    a.exDate === b.exDate
      ? a.symbol < b.symbol
        ? -1
        : 1
      : a.exDate < b.exDate
        ? -1
        : 1,
  );
}
