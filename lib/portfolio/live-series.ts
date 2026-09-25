import {
  marketDay,
  type DailyClose,
  type Dec,
  type PriceSource,
} from "@/lib/engine";

// Punto "en vivo" de las series (spec §6.3 y §6.4). Los gráficos y las métricas de rendimiento se
// calculan con cierres diarios, que el cron guarda una vez por día al terminar la rueda. Durante la
// rueda, "Actualizar precios" trae la cotización de hoy: mientras el cierre de hoy no exista se la
// usa como el último punto de la serie, así el valor de arriba y el gráfico cuentan lo mismo. Puro:
// sin base de datos ni reloj. Al llegar el cierre real, la cotización deja de ser "más nueva que el
// último cierre" y el punto en vivo desaparece solo.

/** Una cotización que puede ser el último punto de una serie. */
export interface LiveQuote {
  price: Dec;
  asOf: Date;
}

/** Un precio de valuación tal como lo elige `pickPrice`: solo la cotización cuenta como en vivo. */
export interface LivePrice {
  price: Dec | null;
  asOf: Date | null;
  source: PriceSource | null;
}

/**
 * Día de rueda (Nueva York) al que cae la cotización, si pasa a ser un punto nuevo; `null` si no.
 * No suma punto:
 *  - sin ningún cierre: el valor saltaría de costo a mercado en un día y eso no es rendimiento;
 *  - una cotización del día del último cierre (o anterior): el cierre gana;
 *  - un precio que no es positivo o una fecha inválida: dato roto.
 * `lastCloseDate` es el último cierre de la serie (YYYY-MM-DD).
 */
export function liveDay(
  lastCloseDate: string | null,
  quote: LiveQuote | null,
): string | null {
  if (lastCloseDate === null || quote === null) return null;
  if (!quote.price.gt(0) || Number.isNaN(quote.asOf.getTime())) return null;
  const day = marketDay(quote.asOf);
  return day > lastCloseDate ? day : null;
}

/** El punto que la cotización agrega a una lista de cierres (ordenada por fecha), o `null`. */
function livePoint(
  closes: readonly DailyClose[],
  quote: LiveQuote | null,
): DailyClose | null {
  const day = liveDay(closes.at(-1)?.date ?? null, quote);
  return day === null || quote === null
    ? null
    : { date: day, close: quote.price };
}

/** La cotización, si es de las que valúan en vivo (`quote`) y tiene todos sus datos. */
export function liveQuoteOf(price: LivePrice | null): LiveQuote | null {
  if (
    price === null ||
    price.source !== "quote" ||
    price.price === null ||
    price.asOf === null
  ) {
    return null;
  }
  return { price: price.price, asOf: price.asOf };
}

export interface LiveSeriesInput {
  /** Cierres por símbolo, de más viejo a más nuevo. */
  closes: ReadonlyMap<string, readonly DailyClose[]>;
  /** Cotización de valuación por símbolo (solo los que se tienen hoy). */
  quotes: ReadonlyMap<string, LiveQuote>;
  /** Cierres del benchmark, de más viejo a más nuevo; vacío si no hay. */
  benchmark: readonly DailyClose[];
  benchmarkQuote: LiveQuote | null;
}

export interface LiveSeries {
  closes: Map<string, DailyClose[]>;
  benchmark: DailyClose[];
  /** El instante más viejo de las cotizaciones que entraron; `null` si quedó solo con cierres. */
  liveAsOf: Date | null;
}

/**
 * Suma a cada serie la cotización de hoy cuando es más nueva que su último cierre. Es todo o
 * nada, para que el portafolio y el benchmark siempre lleguen al mismo día: si el benchmark tiene
 * datos y no llega al mismo día en vivo que las posiciones (por ejemplo, no se pudo actualizar),
 * nadie suma punto y todo queda con cierres, como antes. Un símbolo cuya cotización no es más nueva
 * que su cierre sigue con el cierre, que es lo que hace `pickPrice` para el valor de arriba.
 */
export function applyLiveQuotes(input: LiveSeriesInput): LiveSeries {
  const plain = (): LiveSeries => ({
    closes: new Map([...input.closes].map(([s, list]) => [s, [...list]])),
    benchmark: [...input.benchmark],
    liveAsOf: null,
  });

  const closes = new Map<string, DailyClose[]>();
  const used: Date[] = [];
  let heldDay: string | null = null;
  for (const [symbol, list] of input.closes) {
    const quote = input.quotes.get(symbol) ?? null;
    const point = livePoint(list, quote);
    if (point === null || quote === null) {
      closes.set(symbol, [...list]);
      continue;
    }
    closes.set(symbol, [...list, point]);
    used.push(quote.asOf);
    if (heldDay === null || point.date > heldDay) heldDay = point.date;
  }
  if (heldDay === null) return plain();

  let benchmark = [...input.benchmark];
  if (input.benchmark.length > 0) {
    const point = livePoint(input.benchmark, input.benchmarkQuote);
    if (point === null || input.benchmarkQuote === null) return plain();
    if (point.date !== heldDay) return plain();
    benchmark = [...input.benchmark, point];
    used.push(input.benchmarkQuote.asOf);
  }

  const oldest = used.reduce((min, at) => (at < min ? at : min));
  return { closes, benchmark, liveAsOf: oldest };
}

/**
 * Los cierres de un gráfico de precio (`date`, `close` como texto) con la cotización de hoy al
 * final, si es más nueva que el último cierre.
 */
export function withLiveBar(
  series: ReadonlyArray<{ date: string; close: string }>,
  price: LivePrice | null,
): Array<{ date: string; close: string }> {
  const quote = liveQuoteOf(price);
  const day = liveDay(series.at(-1)?.date ?? null, quote);
  if (day === null || quote === null) return [...series];
  return [...series, { date: day, close: quote.price.toFixed() }];
}
