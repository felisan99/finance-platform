import { addDays, marketDay } from "./dates";
import { D, QTY_EPSILON, ZERO, type Dec } from "./decimal";
import { applyTransaction, createLedger } from "./engine";
import { sortTransactions } from "./ordering";
import type { EngineOptions, Transaction } from "./types";

// Dividendos propuestos a partir de los que detectó el proveedor (`corporate_actions`). Puro.
//
// Cobra quien tenía la acción al cierre del día anterior al ex-dividendo, así que la cantidad sale
// del libro de la cuenta a ese día. El monto por acción del proveedor viene ajustado por los
// splits posteriores (igual que los precios guardados): se des-ajusta con los `SPLIT` del libro que
// ocurrieron desde el ex-dividendo en adelante. El bruto y la retención se redondean al centavo,
// como los liquida un broker.

export interface DividendEvent {
  /** El id de `corporate_actions`. */
  id: string;
  symbol: string;
  /** Fecha ex-dividendo (YYYY-MM-DD). */
  exDate: string;
  /** Por acción, ajustado por splits posteriores (como lo da el proveedor). */
  amount: Dec;
}

export interface DividendSuggestion {
  eventId: string;
  symbol: string;
  exDate: string;
  /** Acciones al cierre del día anterior al ex-dividendo. */
  shares: Dec;
  /** Por acción, en las unidades de esa fecha (des-ajustado por splits). */
  perShare: Dec;
  /** `shares × perShare`, al centavo. */
  gross: Dec;
  /** `gross × tasa`, al centavo. */
  withholding: Dec;
  net: Dec;
}

export interface DividendInput {
  /** Transacciones de UNA cuenta. */
  transactions: readonly Transaction[];
  events: readonly DividendEvent[];
  /** Fracción que retiene EE. UU. (0.3 = 30 %). */
  withholdingRate: Dec;
  /** Día de mercado de hoy: los ex-dividendos posteriores todavía no se proponen. */
  today: string;
  options?: EngineOptions;
}

/**
 * Días alrededor del ex-dividendo en los que un `DIVIDEND` ya cargado del mismo símbolo se toma
 * como ese mismo dividendo (cargado a mano, importado o confirmado antes): no se vuelve a proponer.
 * El cobro suele llegar entre 1 y 6 semanas después del ex-dividendo.
 */
export const RECORDED_BEFORE_DAYS = 7;
export const RECORDED_AFTER_DAYS = 60;

const cents = (value: Dec): Dec => value.toDecimalPlaces(2, D.ROUND_HALF_UP);

export function suggestDividends(input: DividendInput): DividendSuggestion[] {
  if (input.withholdingRate.lt(0) || input.withholdingRate.gt(1)) {
    throw new Error(
      "suggestDividends: la retención tiene que estar entre 0 y 1",
    );
  }
  const txs = sortTransactions(input.transactions).map((tx) => ({
    tx,
    day: marketDay(tx.executedAt),
  }));

  const recorded = txs.filter(({ tx }) => tx.type === "DIVIDEND");
  const alreadyRecorded = (event: DividendEvent) =>
    recorded.some(
      ({ tx, day }) =>
        tx.type === "DIVIDEND" &&
        tx.symbol === event.symbol &&
        day >= addDays(event.exDate, -RECORDED_BEFORE_DAYS) &&
        day <= addDays(event.exDate, RECORDED_AFTER_DAYS),
    );

  const suggestions: DividendSuggestion[] = [];
  for (const event of input.events) {
    if (event.exDate > input.today || !event.amount.gt(0)) continue;
    if (alreadyRecorded(event)) continue;

    // El libro al cierre del día anterior al ex-dividendo.
    let ledger = createLedger();
    for (const { tx, day } of txs) {
      if (day >= event.exDate) break;
      ledger = applyTransaction(ledger, tx, input.options);
    }
    const shares = ledger.positions.get(event.symbol)?.quantity ?? ZERO;
    if (shares.lt(QTY_EPSILON)) continue;

    const splitFactor = txs
      .filter(
        ({ tx, day }) =>
          tx.type === "SPLIT" &&
          tx.symbol === event.symbol &&
          day >= event.exDate,
      )
      .reduce(
        (acc, { tx }) => (tx.type === "SPLIT" ? acc.mul(tx.splitRatio) : acc),
        ZERO.plus(1),
      );
    const perShare = event.amount.mul(splitFactor);
    const gross = cents(shares.mul(perShare));
    if (!gross.gt(0)) continue;
    const withholding = cents(gross.mul(input.withholdingRate));

    suggestions.push({
      eventId: event.id,
      symbol: event.symbol,
      exDate: event.exDate,
      shares,
      perShare,
      gross,
      withholding,
      net: gross.minus(withholding),
    });
  }

  return suggestions.sort((a, b) =>
    a.exDate === b.exDate
      ? a.symbol < b.symbol
        ? -1
        : 1
      : a.exDate < b.exDate
        ? 1
        : -1,
  );
}
