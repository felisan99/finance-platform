import { z } from "zod";
import { D } from "@/lib/engine/decimal";
import { MarketDataError, classifyYahooError } from "./errors";
import { round } from "./numbers";
import { createLimiter, withRetry, type Sleep } from "./retry";
import { cleanText } from "./sanitize";
import { parseCompanyData } from "./yahoo-company";
import type {
  CompanyData,
  CompanyKind,
  CorporateAction,
  DailyBar,
  DailyHistory,
  InstrumentProfile,
  InstrumentSearchResult,
  IntradayPoint,
  InstrumentType,
  IntradayRange,
  MarketDataProvider,
  Quote,
} from "./types";

/**
 * Subconjunto de `yahoo-finance2` que usa la app. Devuelve `unknown` a propósito: lo que llega
 * de Yahoo se valida acá con Zod, no se confía en los tipos de la librería. El cliente real está
 * en `yahoo-client.ts` (único archivo que importa la librería); los tests pasan uno falso.
 */
export interface YahooClient {
  chart(
    symbol: string,
    options: {
      period1: Date;
      period2: Date;
      interval: "1d" | "30m" | "1h";
      events?: string;
    },
  ): Promise<unknown>;
  quote(symbols: string[]): Promise<unknown>;
  search(
    query: string,
    options: { quotesCount: number; newsCount: number },
  ): Promise<unknown>;
  quoteSummary(
    symbol: string,
    options: {
      modules: Array<
        | "assetProfile"
        | "price"
        | "summaryDetail"
        | "defaultKeyStatistics"
        | "earningsHistory"
        | "calendarEvents"
      >;
    },
  ): Promise<unknown>;
}

export interface YahooProviderOptions {
  /** "Ahora" inyectable: decide si la rueda de hoy sigue abierta. */
  now?: () => Date;
  sleep?: Sleep;
  random?: () => number;
  retries?: number;
  concurrency?: number;
  minGapMs?: number;
}

// Símbolos de Yahoo (permite ^ = . -). Los que llegan de la base ya cumplen un CHECK más
// estricto; esto es una segunda defensa antes de armar la URL.
const PROVIDER_SYMBOL = /^[A-Z0-9][A-Z0-9.^=-]{0,14}$/;
// Igual que el CHECK de `instruments.symbol`.
const CANONICAL_SYMBOL = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
// NASDAQ (NMS, NGM, NCM), NYSE (NYQ), NYSE American (ASE), NYSE Arca (PCX) y BATS (BTS).
const US_EXCHANGES = new Set(["NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS"]);
// Cripto: Yahoo las lista en la "bolsa" CCC como pares (`BTC-USD`, `BTC-EUR`). Solo en USD.
const CRYPTO_EXCHANGE = "CCC";
const CRYPTO_USD = /^[A-Z0-9]+-USD$/;

/** El tipo de la app para un `quoteType` de Yahoo; `null` si no se admite (futuros, índices…). */
function typeOf(quoteType: string | null | undefined): InstrumentType | null {
  if (quoteType === "EQUITY") return "STOCK";
  if (quoteType === "ETF") return "ETF";
  if (quoteType === "CRYPTOCURRENCY") return "CRYPTO";
  return null;
}
const QUOTE_CHUNK = 50;
const SEARCH_MAX_LENGTH = 40;

const decimalsHint = z.number().int().min(0).max(10).nullish();

const chartSchema = z.object({
  meta: z.object({
    exchangeTimezoneName: z.string().min(1),
    priceHint: decimalsHint,
    currentTradingPeriod: z
      .object({ regular: z.object({ start: z.date(), end: z.date() }) })
      .nullish(),
  }),
  quotes: z.array(
    z.object({
      date: z.date(),
      close: z.number().nullish(),
      adjclose: z.number().nullish(),
    }),
  ),
  events: z
    .object({
      dividends: z
        .array(z.object({ date: z.date(), amount: z.number() }))
        .nullish(),
      splits: z
        .array(
          z.object({
            date: z.date(),
            numerator: z.number(),
            denominator: z.number(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

const quoteItemSchema = z.object({
  symbol: z.string(),
  regularMarketPrice: z.number().positive(),
  regularMarketChange: z.number().nullish(),
  regularMarketChangePercent: z.number().nullish(),
  regularMarketTime: z.date(),
  currency: z.string().nullish(),
  priceHint: decimalsHint,
});

const searchSchema = z.object({ quotes: z.array(z.unknown()) });
const searchItemSchema = z.object({
  symbol: z.string(),
  quoteType: z.string(),
  exchange: z.string().nullish(),
  longname: z.string().nullish(),
  shortname: z.string().nullish(),
  isYahooFinance: z.boolean().nullish(),
});

const summarySchema = z.object({
  price: z
    .object({
      longName: z.string().nullish(),
      shortName: z.string().nullish(),
      quoteType: z.string().nullish(),
      exchangeName: z.string().nullish(),
      currency: z.string().nullish(),
    })
    .nullish(),
  assetProfile: z
    .object({
      sector: z.string().nullish(),
      industry: z.string().nullish(),
    })
    .nullish(),
});

/**
 * Decimales de un precio. Yahoo trae ruido de float32 (1730.97998046875): se redondea a los
 * decimales que informa el propio Yahoo (`priceHint`, normalmente 2). Sin dato, los tick sizes de
 * EE.UU.: centavos desde 1 USD y cuatro decimales por debajo.
 */
function priceDecimals(hint: number | null | undefined, price: number): number {
  if (typeof hint === "number") return Math.min(6, Math.max(2, hint));
  return price >= 1 ? 2 : 4;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Fecha (YYYY-MM-DD) de un instante en la zona horaria de la bolsa. */
function localDate(instant: Date, timeZone: string): string {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

function assertProviderSymbol(symbol: string): void {
  if (!PROVIDER_SYMBOL.test(symbol)) {
    throw new MarketDataError("BAD_REQUEST", "símbolo con formato inválido", {
      symbol: cleanText(symbol, 20) ?? "",
    });
  }
}

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  symbol?: string,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const where = parsed.error.issues
    .slice(0, 3)
    .map((issue) => issue.path.join(".") || "(raíz)")
    .join(", ");
  throw new MarketDataError(
    "BAD_DATA",
    `respuesta del proveedor con formato inesperado en: ${where}`,
    { symbol },
  );
}

export function createYahooProvider(
  client: YahooClient,
  options: YahooProviderOptions = {},
): MarketDataProvider {
  const now = options.now ?? (() => new Date());
  const limit = createLimiter({
    concurrency: options.concurrency ?? 2,
    minGapMs: options.minGapMs ?? 150,
    sleep: options.sleep,
  });

  // Cada llamada: turno del limitador → reintentos con backoff → errores clasificados.
  const call = <T>(symbol: string | undefined, fn: () => Promise<T>) =>
    limit(() =>
      withRetry(
        async () => {
          try {
            return await fn();
          } catch (error) {
            throw classifyYahooError(error, symbol);
          }
        },
        {
          retries: options.retries,
          sleep: options.sleep,
          random: options.random,
        },
      ),
    );

  async function getDailyHistory(
    symbol: string,
    from: Date,
    to: Date,
  ): Promise<DailyHistory> {
    assertProviderSymbol(symbol);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from >= to
    ) {
      throw new MarketDataError("BAD_REQUEST", "ventana de fechas inválida", {
        symbol,
      });
    }

    const raw = await call(symbol, () =>
      client.chart(symbol, {
        period1: from,
        period2: to,
        interval: "1d",
        events: "div|split",
      }),
    );
    const chart = parseOrThrow(chartSchema, raw, symbol);
    const timeZone = chart.meta.exchangeTimezoneName;

    const fmt = (instant: Date) => {
      try {
        return localDate(instant, timeZone);
      } catch (cause) {
        throw new MarketDataError(
          "BAD_DATA",
          "zona horaria de la bolsa inválida",
          {
            symbol,
            cause,
          },
        );
      }
    };

    // La rueda de hoy, si sigue abierta, trae un "cierre" parcial: no se guarda.
    const regular = chart.meta.currentTradingPeriod?.regular;
    const at = now();
    const openSessionDate =
      regular && at >= regular.start && at < regular.end
        ? fmt(regular.start)
        : null;

    const bars = new Map<string, DailyBar>();
    let droppedBars = 0;
    for (const quote of chart.quotes) {
      const date = fmt(quote.date);
      if (date === openSessionDate) continue;
      const close = quote.close;
      if (close == null || close <= 0) {
        droppedBars++;
        continue;
      }
      const decimals = priceDecimals(chart.meta.priceHint, close);
      const adjClose = quote.adjclose;
      bars.set(date, {
        date,
        close: round(close, decimals),
        adjClose:
          adjClose != null && adjClose > 0 ? round(adjClose, decimals) : null,
      });
    }

    const actions = new Map<string, CorporateAction>();
    for (const split of chart.events?.splits ?? []) {
      if (split.numerator <= 0 || split.denominator <= 0) continue;
      const exDate = fmt(split.date);
      // numeric(20,8): 3:2 → 1.5; split inverso 1:10 → 0.1.
      const ratio = new D(split.numerator)
        .div(split.denominator)
        .toDecimalPlaces(8, D.ROUND_HALF_UP)
        .toFixed();
      actions.set(`SPLIT|${exDate}`, { type: "SPLIT", exDate, ratio });
    }
    for (const dividend of chart.events?.dividends ?? []) {
      if (dividend.amount <= 0) continue;
      const exDate = fmt(dividend.date);
      const amount = round(dividend.amount, 6);
      if (amount === "0") continue;
      actions.set(`DIVIDEND|${exDate}`, { type: "DIVIDEND", exDate, amount });
    }

    return {
      bars: [...bars.values()].sort((a, b) => a.date.localeCompare(b.date)),
      actions: [...actions.values()].sort(
        (a, b) =>
          a.exDate.localeCompare(b.exDate) || a.type.localeCompare(b.type),
      ),
      droppedBars,
    };
  }

  async function getQuotes(symbols: string[]): Promise<Quote[]> {
    symbols.forEach(assertProviderSymbol);
    const unique = [...new Set(symbols)];
    const quotes: Quote[] = [];

    for (let i = 0; i < unique.length; i += QUOTE_CHUNK) {
      const chunk = unique.slice(i, i + QUOTE_CHUNK);
      const raw = await call(undefined, () => client.quote(chunk));
      if (!Array.isArray(raw)) {
        throw new MarketDataError(
          "BAD_DATA",
          "cotizaciones con formato inesperado",
        );
      }
      // Un elemento inválido no tira abajo al resto: se omite, como los símbolos desconocidos.
      for (const item of raw) {
        const parsed = quoteItemSchema.safeParse(item);
        if (!parsed.success) continue;
        const q = parsed.data;
        const decimals = priceDecimals(q.priceHint, q.regularMarketPrice);
        quotes.push({
          symbol: q.symbol.toUpperCase(),
          price: round(q.regularMarketPrice, decimals),
          change:
            q.regularMarketChange != null
              ? round(q.regularMarketChange, decimals)
              : null,
          changePct:
            q.regularMarketChangePercent != null
              ? new D(q.regularMarketChangePercent)
                  .div(100)
                  .toDecimalPlaces(6, D.ROUND_HALF_UP)
                  .toFixed()
              : null,
          asOf: q.regularMarketTime,
          currency: cleanText(q.currency, 3),
        });
      }
    }
    return quotes;
  }

  async function search(query: string): Promise<InstrumentSearchResult[]> {
    const text = cleanText(query, SEARCH_MAX_LENGTH + 1);
    if (!text || text.length > SEARCH_MAX_LENGTH) {
      throw new MarketDataError(
        "BAD_REQUEST",
        `la búsqueda debe tener entre 1 y ${SEARCH_MAX_LENGTH} caracteres`,
      );
    }
    const raw = await call(undefined, () =>
      client.search(text, { quotesCount: 10, newsCount: 0 }),
    );
    const { quotes } = parseOrThrow(searchSchema, raw);

    const results: InstrumentSearchResult[] = [];
    for (const item of quotes) {
      const parsed = searchItemSchema.safeParse(item);
      if (!parsed.success || !parsed.data.isYahooFinance) continue;
      const q = parsed.data;
      const type = typeOf(q.quoteType);
      // Solo EE.UU. o cripto en USD (la app maneja USD) y con un símbolo que la base acepte tal cual.
      if (!type || !q.exchange) continue;
      if (type === "CRYPTO") {
        if (q.exchange !== CRYPTO_EXCHANGE || !CRYPTO_USD.test(q.symbol))
          continue;
      } else if (!US_EXCHANGES.has(q.exchange)) continue;
      if (!CANONICAL_SYMBOL.test(q.symbol)) continue;
      results.push({
        symbol: q.symbol,
        name: cleanText(q.longname ?? q.shortname),
        type,
        exchange: cleanText(q.exchange, 10),
      });
    }
    return results;
  }

  async function getProfile(symbol: string): Promise<InstrumentProfile> {
    assertProviderSymbol(symbol);
    const raw = await call(symbol, () =>
      client.quoteSummary(symbol, { modules: ["assetProfile", "price"] }),
    );
    const summary = parseOrThrow(summarySchema, raw, symbol);
    const quoteType = summary.price?.quoteType;
    return {
      symbol,
      name: cleanText(summary.price?.longName ?? summary.price?.shortName),
      type: typeOf(quoteType),
      exchange: cleanText(summary.price?.exchangeName, 40),
      currency: cleanText(summary.price?.currency, 3),
      sector: cleanText(summary.assetProfile?.sector, 60),
      industry: cleanText(summary.assetProfile?.industry, 80),
    };
  }

  /**
   * Datos de la empresa para la ficha. Los de `summaryDetail` y `defaultKeyStatistics` valen para
   * acciones y ETFs; las ganancias y el calendario existen solo para acciones y van en otra
   * consulta: si esa falla porque Yahoo no tiene datos (empresa nueva, sin resultados) se sigue sin
   * ellas, pero un corte de red o un límite de ritmo no se disimula (el resultado no se cachearía).
   */
  async function getCompanyData(
    symbol: string,
    kind: CompanyKind,
  ): Promise<CompanyData> {
    assertProviderSymbol(symbol);
    const base = await call(symbol, () =>
      client.quoteSummary(symbol, {
        modules: ["summaryDetail", "defaultKeyStatistics"],
      }),
    );
    let extra: unknown = null;
    if (kind === "stock") {
      try {
        extra = await call(symbol, () =>
          client.quoteSummary(symbol, {
            modules: ["earningsHistory", "calendarEvents"],
          }),
        );
      } catch (error) {
        const missing =
          error instanceof MarketDataError &&
          (error.kind === "NOT_FOUND" || error.kind === "BAD_DATA");
        if (!missing) throw error;
      }
    }
    return parseCompanyData(kind, base, extra, symbol);
  }

  // La semana muestra las últimas 5 ruedas (barras de 30 min) y el mes, un mes calendario (barras
  // de 1 hora). Se pide un poco más de ventana y se recorta.
  const INTRADAY = {
    "1w": { days: 7, interval: "30m", sessions: 5 },
    "1m": { days: 31, interval: "1h", sessions: null },
  } as const;

  async function getIntradaySeries(
    symbol: string,
    range: IntradayRange,
  ): Promise<IntradayPoint[]> {
    assertProviderSymbol(symbol);
    const spec = INTRADAY[range];
    const to = now();
    const raw = await call(symbol, () =>
      client.chart(symbol, {
        period1: new Date(to.getTime() - spec.days * 86_400_000),
        period2: to,
        interval: spec.interval,
      }),
    );
    const chart = parseOrThrow(chartSchema, raw, symbol);
    const timeZone = chart.meta.exchangeTimezoneName;

    const byInstant = new Map<number, IntradayPoint>();
    for (const quote of chart.quotes) {
      const close = quote.close;
      if (close == null || close <= 0) continue;
      const decimals = priceDecimals(chart.meta.priceHint, close);
      byInstant.set(quote.date.getTime(), {
        at: quote.date,
        close: round(close, decimals),
      });
    }
    const points = [...byInstant.values()].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
    if (spec.sessions === null) return points;

    let sessionOf: (at: Date) => string;
    try {
      sessionOf = (at) => localDate(at, timeZone);
      sessionOf(to); // la zona horaria de la bolsa puede venir inválida
    } catch (cause) {
      throw new MarketDataError(
        "BAD_DATA",
        "zona horaria de la bolsa inválida",
        {
          symbol,
          cause,
        },
      );
    }
    const days = [...new Set(points.map((p) => sessionOf(p.at)))].slice(
      -spec.sessions,
    );
    const keep = new Set(days);
    return points.filter((p) => keep.has(sessionOf(p.at)));
  }

  return {
    name: "yahoo",
    search,
    getQuotes,
    getDailyHistory,
    getProfile,
    getCompanyData,
    getIntradaySeries,
  };
}
