import { z } from "zod";
import { MarketDataError } from "./errors";
import { round } from "./numbers";
import { cleanText } from "./sanitize";
import type { CompanyData, EarningsQuarter } from "./types";

// Datos de la empresa de `quoteSummary` (summaryDetail, defaultKeyStatistics, earningsHistory y
// calendarEvents). Es entrada no confiable y Yahoo saca o cambia campos sin aviso: cada campo se
// valida por su cuenta y, si falta o viene con otro tipo, queda en `null` (esa fila no se muestra);
// no se descarta todo por un dato roto. Los números salen como strings decimales.

/** Número finito, o `null` si falta o no es un número. */
const num = z.number().nullish().catch(null);
const date = z.date().nullish().catch(null);
const text = z.string().nullish().catch(null);

const summaryDetailSchema = z
  .object({
    currency: text,
    previousClose: num,
    open: num,
    dayLow: num,
    dayHigh: num,
    fiftyTwoWeekLow: num,
    fiftyTwoWeekHigh: num,
    volume: num,
    averageVolume: num,
    marketCap: num,
    trailingPE: num,
    forwardPE: num,
    dividendRate: num,
    dividendYield: num,
    yield: num,
    beta: num,
    priceToSalesTrailing12Months: num,
    totalAssets: num,
    navPrice: num,
    exDividendDate: date,
  })
  .nullish()
  .catch(null);

const keyStatisticsSchema = z
  .object({
    trailingEps: num,
    impliedSharesOutstanding: num,
    sharesOutstanding: num,
    floatShares: num,
    priceToBook: num,
    bookValue: num,
    beta: num,
    totalAssets: num,
    category: text,
    ytdReturn: num,
  })
  .nullish()
  .catch(null);

const earningsHistorySchema = z
  .object({
    history: z
      .array(
        z
          .object({
            quarter: date,
            epsActual: num,
            epsEstimate: num,
            epsDifference: num,
          })
          .catch({
            quarter: null,
            epsActual: null,
            epsEstimate: null,
            epsDifference: null,
          }),
      )
      .nullish()
      .catch(null),
  })
  .nullish()
  .catch(null);

const calendarSchema = z
  .object({
    earnings: z
      .object({ earningsDate: z.array(z.date()).nullish().catch(null) })
      .nullish()
      .catch(null),
  })
  .nullish()
  .catch(null);

const baseSchema = z.object({
  summaryDetail: summaryDetailSchema,
  defaultKeyStatistics: keyStatisticsSchema,
});
const extraSchema = z.object({
  earningsHistory: earningsHistorySchema,
  calendarEvents: calendarSchema,
});

// Tope de lo que se acepta: un valor por encima es un dato roto, no una empresa.
const MAX_ABS = 1e15;
const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) < MAX_ABS;

/** Monto o razón que tiene que ser positivo (precios, capitalización…). */
function positive(
  value: number | null | undefined,
  decimals: number,
): string | null {
  return finite(value) && value > 0 ? round(value, decimals) : null;
}

/** Monto o razón con signo (BPA, diferencia, beta, retorno). */
function signed(
  value: number | null | undefined,
  decimals: number,
): string | null {
  return finite(value) ? round(value, decimals) : null;
}

/** Cantidad entera positiva (volumen, acciones, capitalización). */
function count(value: number | null | undefined): number | null {
  return finite(value) && value > 0 ? Math.round(value) : null;
}

/** Día (YYYY-MM-DD) de una fecha que Yahoo manda a medianoche UTC. */
const utcDay = (value: Date): string => value.toISOString().slice(0, 10);

const newYork = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MAX_QUARTERS = 4;

function parseEarnings(
  history: z.infer<typeof earningsHistorySchema>,
): EarningsQuarter[] {
  const byPeriod = new Map<string, EarningsQuarter>();
  for (const item of history?.history ?? []) {
    if (!item.quarter || Number.isNaN(item.quarter.getTime())) continue;
    // Un trimestre sin BPA real todavía no se publicó: no hay nada que mostrar.
    const epsActual = signed(item.epsActual, 4);
    if (epsActual === null) continue;
    const periodEnd = utcDay(item.quarter);
    byPeriod.set(periodEnd, {
      periodEnd,
      epsActual,
      epsEstimate: signed(item.epsEstimate, 4),
      epsDifference: signed(item.epsDifference, 4),
    });
  }
  return [...byPeriod.values()]
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .slice(-MAX_QUARTERS);
}

/**
 * Arma los datos de la empresa con lo que devolvieron los módulos. `base` es la respuesta de
 * `summaryDetail` + `defaultKeyStatistics` (obligatoria); `extra`, la de `earningsHistory` +
 * `calendarEvents` (solo acciones; `null` si no se pidió o no hubo).
 */
export function parseCompanyData(
  kind: "stock" | "etf",
  base: unknown,
  extra: unknown,
  symbol?: string,
): CompanyData {
  const parsedBase = baseSchema.safeParse(base);
  if (!parsedBase.success) {
    throw new MarketDataError(
      "BAD_DATA",
      "datos de la empresa con formato inesperado",
      { symbol },
    );
  }
  const detail = parsedBase.data.summaryDetail ?? null;
  const stats = parsedBase.data.defaultKeyStatistics ?? null;

  const parsedExtra = extraSchema.safeParse(extra ?? {});
  const earnings = parsedExtra.success
    ? parseEarnings(parsedExtra.data.earningsHistory)
    : [];
  const nextEarnings = parsedExtra.success
    ? (parsedExtra.data.calendarEvents?.earnings?.earningsDate?.find(
        (at) => !Number.isNaN(at.getTime()),
      ) ?? null)
    : null;

  return {
    kind,
    currency: cleanText(detail?.currency, 3),
    previousClose: positive(detail?.previousClose, 4),
    open: positive(detail?.open, 4),
    dayLow: positive(detail?.dayLow, 4),
    dayHigh: positive(detail?.dayHigh, 4),
    fiftyTwoWeekLow: positive(detail?.fiftyTwoWeekLow, 4),
    fiftyTwoWeekHigh: positive(detail?.fiftyTwoWeekHigh, 4),
    volume: count(detail?.volume),
    averageVolume: count(detail?.averageVolume),
    marketCap: count(detail?.marketCap),
    trailingPE: positive(detail?.trailingPE, 4),
    forwardPE: positive(detail?.forwardPE, 4),
    epsTrailing: signed(stats?.trailingEps, 4),
    dividendRate: positive(detail?.dividendRate, 4),
    dividendYield: positive(detail?.dividendYield ?? detail?.yield, 6),
    sharesOutstanding: count(
      stats?.impliedSharesOutstanding ?? stats?.sharesOutstanding,
    ),
    floatShares: count(stats?.floatShares),
    priceToBook: positive(stats?.priceToBook, 4),
    bookValue: positive(stats?.bookValue, 4),
    priceToSales: positive(detail?.priceToSalesTrailing12Months, 4),
    beta: signed(detail?.beta ?? stats?.beta, 4),
    totalAssets: count(detail?.totalAssets ?? stats?.totalAssets),
    navPrice: positive(detail?.navPrice, 4),
    category: cleanText(stats?.category, 60),
    ytdReturn: signed(stats?.ytdReturn, 6),
    nextEarningsDate: nextEarnings ? newYork.format(nextEarnings) : null,
    exDividendDate: detail?.exDividendDate
      ? Number.isNaN(detail.exDividendDate.getTime())
        ? null
        : utcDay(detail.exDividendDate)
      : null,
    earnings,
  };
}
