import { d, pickPrice, type Dec, type PriceSource } from "@/lib/engine";
import { liveDay, liveQuoteOf, type LivePrice } from "./live-series";
import { typeLabelOf, type TypeLabel } from "./instrument-type";
import type { InstrumentRow, QuoteRow, WatchlistMarketRow } from "./rows";

// Vista de la watchlist (spec §10.4): precio, cambio del día, rango de 52 semanas y minigráfico de
// cada símbolo seguido. Puro: recibe filas ya leídas y no toca la base ni la hora.

/** Máximo de símbolos por watchlist (lo aplica también un trigger en la base). */
export const WATCHLIST_MAX = 50;
/** Cierres que dibuja el minigráfico (unos tres meses de ruedas). */
export const SPARK_POINTS = 60;
/** Ventana del rango de "52 semanas", en días corridos. */
export const RANGE_DAYS = 365;

export interface WatchlistInput {
  instrument: InstrumentRow;
  quote: QuoteRow | null;
  market: WatchlistMarketRow | null;
}

/** Rango de precios; `position` es dónde está el precio actual (0 = mínimo, 1 = máximo). */
export interface PriceRange {
  low: Dec;
  high: Dec;
  position: number;
}

export interface WatchlistRowView {
  instrumentId: string;
  symbol: string;
  name: string | null;
  typeLabel: TypeLabel | null;
  price: Dec | null;
  priceSource: PriceSource | null;
  priceAsOf: Date | null;
  /** Por acción: precio − cierre anterior. */
  dayChange: Dec | null;
  /** Fracción sobre el cierre anterior. */
  dayChangePct: Dec | null;
  /** `null` sin precio o si el rango es plano (mínimo = máximo): no hay barra que dibujar. */
  range: PriceRange | null;
  /** Cierres para el minigráfico, de más viejo a más nuevo; vacío si hay menos de dos. */
  spark: number[];
}

export { typeLabelOf } from "./instrument-type";

/**
 * Rango de los cierres de 52 semanas con el precio actual adentro. El precio se suma al rango:
 * si hoy cotiza por encima del máximo de los cierres, ese es el nuevo máximo y la marca queda en
 * el extremo, no afuera de la barra.
 */
export function buildRange(
  price: Dec,
  low: Dec | null,
  high: Dec | null,
): PriceRange | null {
  const min = low === null || price.lt(low) ? price : low;
  const max = high === null || price.gt(high) ? price : high;
  if (!max.gt(min)) return null;
  return {
    low: min,
    high: max,
    position: price.minus(min).div(max.minus(min)).toNumber(),
  };
}

/**
 * Cierres recientes (de más viejo a más nuevo) para un minigráfico, y al final la cotización de hoy
 * si todavía no hay cierre de hoy (`live-series.ts`). Con menos de dos no hay línea que dibujar:
 * vacío. Los usa también "Tus posiciones" de Inicio.
 */
export function sparkOf(
  market: Pick<WatchlistMarketRow, "recent" | "last_date"> | null,
  live: LivePrice | null = null,
): number[] {
  const values = (market?.recent ?? [])
    .map(([, close]) => Number(close))
    .filter((value) => Number.isFinite(value));
  const quote = liveQuoteOf(live);
  if (quote !== null && liveDay(market?.last_date ?? null, quote) !== null) {
    const price = quote.price.toNumber();
    if (Number.isFinite(price)) values.push(price);
  }
  return values.length >= 2 ? values : [];
}

/** Un símbolo, con lo que hay de él en la base. Sin cotización ni cierres queda "sin precio". */
export function buildWatchlistRow(input: WatchlistInput): WatchlistRowView {
  const { instrument, quote, market } = input;

  const picked = pickPrice(
    quote
      ? {
          price: d(quote.price),
          change: quote.change === null ? null : d(quote.change),
          asOf: new Date(quote.as_of),
        }
      : null,
    market
      ? {
          last: { date: market.last_date, close: d(market.last_close) },
          prev:
            market.prev_close !== null && market.prev_date !== null
              ? { date: market.prev_date, close: d(market.prev_close) }
              : null,
        }
      : null,
  );

  const previous = picked?.previousClose ?? null;
  const dayChange =
    picked && previous !== null && previous.gt(0)
      ? picked.price.minus(previous)
      : null;

  return {
    instrumentId: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    typeLabel: typeLabelOf(instrument.type),
    price: picked?.price ?? null,
    priceSource: picked?.source ?? null,
    priceAsOf: picked?.asOf ?? null,
    dayChange,
    dayChangePct:
      dayChange === null || previous === null ? null : dayChange.div(previous),
    range: picked
      ? buildRange(
          picked.price,
          market?.low_close != null ? d(market.low_close) : null,
          market?.high_close != null ? d(market.high_close) : null,
        )
      : null,
    spark: sparkOf(market, picked),
  };
}

// Sin `localeCompare`: el orden no puede depender del idioma del servidor.
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Las filas de la watchlist en orden alfabético por símbolo. */
export function buildWatchlistView(
  inputs: readonly WatchlistInput[],
): WatchlistRowView[] {
  return inputs
    .map(buildWatchlistRow)
    .sort((a, b) => compareText(a.symbol, b.symbol));
}
