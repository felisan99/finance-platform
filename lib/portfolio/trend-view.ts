import type { Dec, ValuedPosition, ValuedPortfolio } from "@/lib/engine";
import type { InstrumentRow, WatchlistMarketRow } from "./rows";
import { sparkOf } from "./watchlist";

// "Tus posiciones" de Inicio: las más grandes, con su tendencia de los últimos cierres. Puro:
// recibe la valuación y las filas de mercado ya leídas.

/** Cuántas posiciones se muestran (las de mayor valor). */
export const TREND_ROWS = 5;
/** Cierres del minigráfico: unas cuatro semanas de ruedas (~un mes). */
export const TREND_POINTS = 22;

export interface TrendRowView {
  symbol: string;
  name: string | null;
  href: string;
  /** Cambio del día en fracción; `null` sin cierre anterior. */
  dayChangePct: Dec | null;
  /** Ganancia no realizada sobre el costo, en fracción. */
  unrealizedPct: Dec | null;
  /** Cierres de más viejo a más nuevo; vacío si no hay historial para dibujar. */
  spark: number[];
}

/** Posiciones abiertas con precio, de mayor a menor valor (empates por símbolo), hasta `TREND_ROWS`. */
export function pickTrendPositions(valued: ValuedPortfolio): ValuedPosition[] {
  return valued.positions
    .filter((p) => p.isOpen && p.marketValue !== null)
    .sort(
      (a, b) =>
        b.marketValue!.cmp(a.marketValue!) ||
        (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0),
    )
    .slice(0, TREND_ROWS);
}

export function buildTrendRows(
  positions: readonly ValuedPosition[],
  instrumentBySymbol: ReadonlyMap<string, InstrumentRow>,
  marketByInstrumentId: ReadonlyMap<string, WatchlistMarketRow>,
): TrendRowView[] {
  return positions.map((position) => {
    const instrument = instrumentBySymbol.get(position.symbol);
    return {
      symbol: position.symbol,
      name: instrument?.name ?? null,
      href: `/positions/${encodeURIComponent(position.symbol)}`,
      dayChangePct: position.dayChangePct,
      unrealizedPct: position.unrealizedPct,
      spark: sparkOf(
        instrument ? (marketByInstrumentId.get(instrument.id) ?? null) : null,
        {
          price: position.price,
          asOf: position.priceAsOf,
          source: position.priceSource,
        },
      ),
    };
  });
}
