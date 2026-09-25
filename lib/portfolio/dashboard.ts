import {
  ZERO,
  type Dec,
  type Transaction,
  type ValuedPortfolio,
} from "@/lib/engine";
import { localYear } from "./time";

/** Lo que muestra Inicio (spec §10.1), ya resuelto: la pantalla solo formatea. */
export interface DashboardView {
  /** `false` si todavía no hay ninguna transacción: se muestra el estado vacío. */
  hasTransactions: boolean;
  valued: ValuedPortfolio;
  /** Dividendos cobrados en el año calendario de `now` (hora de Montevideo). */
  dividendsThisYear: Dec;
  /** Depósitos menos retiros de todo el historial: la plata que la persona puso de su bolsillo. */
  netContributed: Dec;
  /**
   * Valor total menos lo aportado neto: lo que el portafolio ganó (o perdió) en total, con lo
   * realizado, lo no realizado y los dividendos. `null` si el valor total es parcial (falta algún
   * precio) o si no hay aportes positivos que comparar.
   */
  totalGain: Dec | null;
  /** `totalGain` sobre lo aportado (no es un rendimiento ponderado por tiempo: para eso está el TWR). */
  totalGainPct: Dec | null;
  /** El total no incluye a estas posiciones abiertas porque no tienen precio. */
  missingPrices: string[];
  /** Advertencia del motor: probablemente falta cargar un depósito. */
  negativeCash: boolean;
  /** La fecha más antigua de los precios usados (la que hay que mostrar como "precios al …"). */
  oldestPriceAt: Date | null;
}

export function buildDashboard(
  valued: ValuedPortfolio,
  transactions: readonly Transaction[],
  now: Date,
): DashboardView {
  const year = localYear(now);
  const dividendsThisYear = transactions.reduce(
    (sum, tx) =>
      tx.type === "DIVIDEND" && localYear(tx.executedAt) === year
        ? sum.plus(tx.amount)
        : sum,
    ZERO,
  );

  const netContributed = transactions.reduce(
    (sum, tx) =>
      tx.type === "DEPOSIT"
        ? sum.plus(tx.amount)
        : tx.type === "WITHDRAWAL"
          ? sum.minus(tx.amount)
          : sum,
    ZERO,
  );
  const comparable = valued.missingPrices.length === 0 && netContributed.gt(0);
  const totalGain = comparable ? valued.totalValue.minus(netContributed) : null;

  const priceDates = valued.positions.flatMap((p) =>
    p.priceAsOf ? [p.priceAsOf] : [],
  );
  const oldestPriceAt =
    priceDates.length === 0
      ? null
      : priceDates.reduce((oldest, at) => (at < oldest ? at : oldest));

  return {
    hasTransactions: transactions.length > 0,
    valued,
    dividendsThisYear,
    netContributed,
    totalGain,
    totalGainPct: totalGain === null ? null : totalGain.div(netContributed),
    missingPrices: valued.missingPrices,
    negativeCash: valued.cash.lt(0),
    oldestPriceAt,
  };
}
