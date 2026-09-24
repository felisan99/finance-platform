import {
  ZERO,
  type Dec,
  type Transaction,
  type ValuedPortfolio,
} from "@/lib/engine";
import { localYear } from "./time";

export interface Mover {
  symbol: string;
  dayChange: Dec;
  /** Fracción sobre el cierre anterior. */
  dayChangePct: Dec;
}

/** Lo que muestra Inicio (spec §10.1), ya resuelto: la pantalla solo formatea. */
export interface DashboardView {
  /** `false` si todavía no hay ninguna transacción: se muestra el estado vacío. */
  hasTransactions: boolean;
  valued: ValuedPortfolio;
  /** Dividendos cobrados en el año calendario de `now` (hora de Montevideo). */
  dividendsThisYear: Dec;
  /** Hasta 3, de mayor a menor variación porcentual del día. */
  gainers: Mover[];
  /** Hasta 3, de la peor variación porcentual del día hacia arriba. */
  losers: Mover[];
  /** El total no incluye a estas posiciones abiertas porque no tienen precio. */
  missingPrices: string[];
  /** Advertencia del motor: probablemente falta cargar un depósito. */
  negativeCash: boolean;
  /** La fecha más antigua de los precios usados (la que hay que mostrar como "precios al …"). */
  oldestPriceAt: Date | null;
}

const TOP = 3;

const bySymbol = (a: Mover, b: Mover) =>
  a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;

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

  const movers: Mover[] = valued.positions.flatMap((p) =>
    p.isOpen && p.dayChange !== null && p.dayChangePct !== null
      ? [
          {
            symbol: p.symbol,
            dayChange: p.dayChange,
            dayChangePct: p.dayChangePct,
          },
        ]
      : [],
  );
  const gainers = movers
    .filter((m) => m.dayChange.gt(0))
    .sort((a, b) => b.dayChangePct.cmp(a.dayChangePct) || bySymbol(a, b))
    .slice(0, TOP);
  const losers = movers
    .filter((m) => m.dayChange.lt(0))
    .sort((a, b) => a.dayChangePct.cmp(b.dayChangePct) || bySymbol(a, b))
    .slice(0, TOP);

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
    gainers,
    losers,
    missingPrices: valued.missingPrices,
    negativeCash: valued.cash.lt(0),
    oldestPriceAt,
  };
}
