import type { YahooClient } from "../yahoo";

// Respuestas con la forma y los valores de los probes contra Yahoo real (2026-09-24): ruido de
// float32, barras con `close: null`, eventos de split y dividendo, `currentTradingPeriod`.

export const NY = "America/New_York";

/** Barra de `chart()`. Lleva campos extra (open/high/low/volume) que el provider debe ignorar. */
export function bar(
  iso: string,
  close: number | null,
  adjclose: number | null = close,
) {
  return {
    date: new Date(iso),
    open: 1,
    high: 2,
    low: 0.5,
    volume: 1000,
    close,
    adjclose,
  };
}

export interface ChartResponseOptions {
  quotes?: Array<ReturnType<typeof bar>>;
  timeZone?: string;
  priceHint?: number | null;
  regular?: { start: string; end: string } | null;
  events?: {
    dividends?: Array<{ date: Date; amount: number }>;
    splits?: Array<{
      date: Date;
      numerator: number;
      denominator: number;
      splitRatio?: string;
    }>;
  };
}

export function chartResponse(options: ChartResponseOptions = {}) {
  const {
    quotes = [],
    timeZone = NY,
    priceHint = 2,
    regular = {
      start: "2026-09-23T13:30:00.000Z",
      end: "2026-09-23T20:00:00.000Z",
    },
    events,
  } = options;
  return {
    meta: {
      currency: "USD",
      symbol: "X",
      exchangeTimezoneName: timeZone,
      gmtoffset: -14400,
      priceHint,
      currentTradingPeriod: regular
        ? {
            pre: {
              start: new Date("2026-09-23T08:00:00.000Z"),
              end: new Date(regular.start),
            },
            regular: {
              start: new Date(regular.start),
              end: new Date(regular.end),
            },
            post: {
              start: new Date(regular.end),
              end: new Date("2026-09-24T00:00:00.000Z"),
            },
          }
        : undefined,
    },
    quotes,
    ...(events ? { events } : {}),
  };
}

export function quoteItem(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "VOO",
    regularMarketPrice: 707.5999755859375,
    regularMarketChange: -5.18005,
    regularMarketChangePercent: -0.726739,
    regularMarketTime: new Date("2026-09-23T20:00:00.000Z"),
    currency: "USD",
    quoteType: "ETF",
    marketState: "POST",
    ...overrides,
  };
}

type Handler<K extends keyof YahooClient> = YahooClient[K];

/** Cliente falso: cada método devuelve lo que se le indique y registra los llamados. */
export function fakeClient(
  handlers: Partial<{ [K in keyof YahooClient]: Handler<K> }> = {},
) {
  const calls = {
    chart: [] as unknown[][],
    quote: [] as unknown[][],
    search: [] as unknown[][],
    quoteSummary: [] as unknown[][],
  };
  const client: YahooClient = {
    chart: async (...args) => {
      calls.chart.push(args);
      if (!handlers.chart) throw new Error("chart no configurado");
      return handlers.chart(...args);
    },
    quote: async (...args) => {
      calls.quote.push(args);
      if (!handlers.quote) throw new Error("quote no configurado");
      return handlers.quote(...args);
    },
    search: async (...args) => {
      calls.search.push(args);
      if (!handlers.search) throw new Error("search no configurado");
      return handlers.search(...args);
    },
    quoteSummary: async (...args) => {
      calls.quoteSummary.push(args);
      if (!handlers.quoteSummary)
        throw new Error("quoteSummary no configurado");
      return handlers.quoteSummary(...args);
    },
  };
  return { client, calls };
}

/** Error como el que lanza yahoo-finance2 para una respuesta HTTP no exitosa. */
export function httpError(status: number, body = "error"): Error {
  const error = new Error(body);
  error.name = "HTTPError";
  (error as Error & { code: number }).code = status;
  return error;
}

/** Opciones para que los tests no esperen de verdad. */
export const fastOptions = {
  sleep: async () => {},
  random: () => 0.5,
  minGapMs: 0,
} as const;
