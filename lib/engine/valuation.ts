import { ZERO, type Dec } from "./decimal";
import type { EngineResult, Position } from "./types";

// Valuación de un libro mayor con precios de mercado (spec §6.1, §6.3). Puro: los precios llegan
// por parámetro y nada se redondea (el redondeo es solo de presentación).

export type PriceSource = "quote" | "close";

/** Precio con el que se valúa un símbolo, y de cuándo es. */
export interface PriceInfo {
  price: Dec;
  /** Instante de la cotización, o las 21:00 UTC de la fecha del cierre (siempre después del cierre de NY). */
  asOf: Date;
  source: PriceSource;
  /** Cierre del día de mercado anterior, para el cambio del día; `null` si no se conoce. */
  previousClose: Dec | null;
}

export interface QuoteInput {
  price: Dec;
  /** `price − cierre anterior` según el proveedor. */
  change: Dec | null;
  asOf: Date;
}

export interface DailyClose {
  /** YYYY-MM-DD */
  date: string;
  close: Dec;
}

export interface ClosesInput {
  last: DailyClose;
  prev: DailyClose | null;
}

const utcDay = (instant: Date) => instant.toISOString().slice(0, 10);

/**
 * Elige el precio de valuación (spec §6.3): la cotización si no es más vieja que el último cierre
 * diario; si no, el último cierre, mostrando su fecha. Devuelve `null` si no hay ninguno.
 *
 * El cierre anterior sale de `change` cuando el proveedor lo informa (es lo más fiel); si no, de
 * los cierres diarios: si la cotización es de un día posterior al último cierre, ese cierre ES el
 * anterior; si es del mismo día, el anterior es el penúltimo.
 */
export function pickPrice(
  quote: QuoteInput | null,
  closes: ClosesInput | null,
): PriceInfo | null {
  if (quote && (closes === null || utcDay(quote.asOf) >= closes.last.date)) {
    let previousClose: Dec | null = null;
    if (quote.change !== null) {
      previousClose = quote.price.minus(quote.change);
    } else if (closes) {
      previousClose =
        utcDay(quote.asOf) > closes.last.date
          ? closes.last.close
          : (closes.prev?.close ?? null);
    }
    // Un cierre anterior no positivo sería un dato roto: sin él no hay cambio del día.
    if (previousClose !== null && !previousClose.gt(0)) previousClose = null;
    return {
      price: quote.price,
      asOf: quote.asOf,
      source: "quote",
      previousClose,
    };
  }
  if (closes) {
    return {
      price: closes.last.close,
      asOf: new Date(`${closes.last.date}T21:00:00.000Z`),
      source: "close",
      previousClose: closes.prev?.close ?? null,
    };
  }
  return null;
}

export interface ValuedPosition extends Position {
  price: Dec | null;
  priceAsOf: Date | null;
  priceSource: PriceSource | null;
  /** `null` si la posición está cerrada o no hay precio. */
  marketValue: Dec | null;
  unrealizedPnl: Dec | null;
  /** Fracción sobre el costo base (0.1 = +10 %); `null` sin precio o con costo base 0. */
  unrealizedPct: Dec | null;
  dayChange: Dec | null;
  /** Fracción sobre el valor del cierre anterior. */
  dayChangePct: Dec | null;
  /** Valor de mercado / valor total del portafolio (incluye el efectivo). */
  weight: Dec | null;
}

export interface ValuedPortfolio {
  positions: ValuedPosition[];
  /** Σ valor de las posiciones abiertas que tienen precio. */
  marketValue: Dec;
  cash: Dec;
  /** `marketValue + cash`. Es parcial si falta el precio de alguna posición (ver `missingPrices`). */
  totalValue: Dec;
  unrealizedPnl: Dec;
  /** Sobre el costo base de las posiciones que tienen precio. */
  unrealizedPct: Dec | null;
  /** `null` si ninguna posición tiene cierre anterior conocido. */
  dayChange: Dec | null;
  /** Sobre el valor total del cierre anterior (`totalValue − dayChange`, incluye el efectivo). */
  dayChangePct: Dec | null;
  realizedPnl: Dec;
  dividends: Dec;
  /** Símbolos abiertos sin precio: el valor total no los incluye. */
  missingPrices: string[];
}

function sum(values: readonly Dec[]): Dec {
  return values.reduce((acc, value) => acc.plus(value), ZERO);
}

/**
 * Valúa las posiciones abiertas con `prices` (por símbolo). Las cerradas conservan su realizado y
 * no llevan valores de mercado. Una posición abierta sin precio no se suma al valor total ni a las
 * ganancias: se lista en `missingPrices` para que la pantalla avise que el total es parcial.
 */
export function valuePortfolio(
  result: EngineResult,
  prices: ReadonlyMap<string, PriceInfo>,
): ValuedPortfolio {
  const staged = result.positions.map((position) => {
    const info = position.isOpen ? (prices.get(position.symbol) ?? null) : null;
    const marketValue = info ? position.quantity.times(info.price) : null;
    const dayChange =
      info?.previousClose != null
        ? info.price.minus(info.previousClose).times(position.quantity)
        : null;
    return { position, info, marketValue, dayChange };
  });

  const pricedOpen = staged.filter((s) => s.marketValue !== null);
  const marketValue = sum(pricedOpen.map((s) => s.marketValue as Dec));
  const costPriced = sum(pricedOpen.map((s) => s.position.costBasis));
  const unrealizedPnl = marketValue.minus(costPriced);
  const totalValue = marketValue.plus(result.cash);

  const withDay = staged.filter((s) => s.dayChange !== null);
  const dayChange =
    withDay.length > 0 ? sum(withDay.map((s) => s.dayChange as Dec)) : null;
  const previousTotal = dayChange === null ? null : totalValue.minus(dayChange);

  const positions: ValuedPosition[] = staged.map(
    ({ position, info, marketValue: value, dayChange: change }) => {
      const unrealized =
        value === null ? null : value.minus(position.costBasis);
      const previousValue =
        info?.previousClose != null
          ? info.previousClose.times(position.quantity)
          : null;
      return {
        ...position,
        price: info?.price ?? null,
        priceAsOf: info?.asOf ?? null,
        priceSource: info?.source ?? null,
        marketValue: value,
        unrealizedPnl: unrealized,
        unrealizedPct:
          unrealized === null || position.costBasis.isZero()
            ? null
            : unrealized.div(position.costBasis),
        dayChange: change,
        dayChangePct:
          change === null || previousValue === null || previousValue.isZero()
            ? null
            : change.div(previousValue),
        weight:
          value === null || !totalValue.gt(0) ? null : value.div(totalValue),
      };
    },
  );

  return {
    positions,
    marketValue,
    cash: result.cash,
    totalValue,
    unrealizedPnl,
    unrealizedPct: costPriced.isZero() ? null : unrealizedPnl.div(costPriced),
    dayChange,
    dayChangePct:
      dayChange === null || previousTotal === null || !previousTotal.gt(0)
        ? null
        : dayChange.div(previousTotal),
    realizedPnl: result.totals.realizedPnl,
    dividends: result.totals.dividends,
    missingPrices: staged
      .filter((s) => s.position.isOpen && s.info === null)
      .map((s) => s.position.symbol),
  };
}
