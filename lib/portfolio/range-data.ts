import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { describeError, type CompanyData } from "@/lib/market-data";
import { addDays, isoDate } from "@/lib/market-jobs/dates";
import {
  kindOf,
  loadCompanyData,
  loadIntraday,
  orNullAfter,
  providerSymbolOf,
} from "./company-data";
import { withLiveBar, type LivePrice } from "./live-series";
import { getPriceSeries, getWatchlistMarket } from "./queries";
import {
  buildRangeSeries,
  dailyInput,
  sliceDaily,
  type IntradayChartRange,
  type RangeSeries,
  type Week52Input,
} from "./range-chart";
import type { InstrumentRow } from "./rows";
import { RANGE_DAYS } from "./watchlist";

// Arma las series del gráfico de precio de la ficha de un activo con lo que hay en la base y en
// Yahoo. La lógica de armado es pura (`range-chart.ts`); acá solo se juntan las lecturas.

type Client = SupabaseClient<Database>;

/** Cuánto se espera a los datos de la empresa antes de dibujar el gráfico con los cierres. */
const COMPANY_WAIT_MS = 2500;
/** Cierres que hacen falta para el respaldo de la semana y del mes. */
const FALLBACK_DAYS = 40;

/** Los datos de la empresa para el gráfico: no lo hacen esperar más de `COMPANY_WAIT_MS`. */
export function companyForChart(
  instrument: InstrumentRow,
): Promise<CompanyData | null> {
  return orNullAfter(
    loadCompanyData(providerSymbolOf(instrument), kindOf(instrument)),
    COMPANY_WAIT_MS,
  );
}

/**
 * Rango de 52 semanas: el del proveedor (incluye los extremos dentro del día); si no vino, el de
 * los cierres diarios guardados.
 */
export async function loadWeek52(
  client: Client,
  instrument: InstrumentRow,
  company: CompanyData | null,
  now: Date,
): Promise<Week52Input> {
  if (company?.fiftyTwoWeekLow && company.fiftyTwoWeekHigh) {
    return { low: company.fiftyTwoWeekLow, high: company.fiftyTwoWeekHigh };
  }
  // El RPC pide al menos 2 puntos (`p_points`); acá solo interesan el mínimo y el máximo de cierres.
  // Es un extra del gráfico: si esta lectura falla, el gráfico se dibuja igual, sin las líneas.
  try {
    const [market] = await getWatchlistMarket(
      client,
      [instrument.id],
      addDays(isoDate(now), -RANGE_DAYS),
      2,
    );
    return { low: market?.low_close ?? null, high: market?.high_close ?? null };
  } catch (error) {
    console.error("[week52]", instrument.symbol, describeError(error));
    return { low: null, high: null };
  }
}

/** Las series que salen de los cierres diarios: se arman juntas en el servidor y no se piden. */
export interface DailyRanges {
  "3m": RangeSeries | null;
  "1y": RangeSeries | null;
}

/**
 * El año de cierres diarios (con la cotización de hoy al final si todavía no hay cierre de hoy) y,
 * recortados de esa misma lectura, los últimos 3 meses: una sola consulta y ninguna a Yahoo.
 */
export async function loadDailyRanges(args: {
  client: Client;
  instrument: InstrumentRow;
  price: LivePrice | null;
  week52: Week52Input;
  now: Date;
  /** Cierres ya leídos (de la ficha, que lee más años): se recortan al último año sin otra consulta. */
  closes?: Promise<Array<{ date: string; close: string }> | null>;
}): Promise<DailyRanges> {
  const from = addDays(isoDate(args.now), -RANGE_DAYS);
  const closes = args.closes
    ? ((await args.closes) ?? []).filter((row) => row.date >= from)
    : await getPriceSeries(args.client, args.instrument.id, from);
  const points = dailyInput(withLiveBar(closes, args.price));
  return {
    "3m": buildRangeSeries({
      range: "3m",
      source: "daily",
      points: sliceDaily("3m", points),
      week52: args.week52,
    }),
    "1y": buildRangeSeries({
      range: "1y",
      source: "daily",
      points,
      week52: args.week52,
    }),
  };
}

export type RangeLoad =
  | { ok: true; series: RangeSeries; notice: string | null }
  | { ok: false; message: string };

/**
 * La semana o el mes con barras del día. Si Yahoo no responde o no trae barras, cae a los cierres
 * diarios guardados y lo avisa: mejor un gráfico más ralo que uno roto.
 */
export async function loadIntradayRange(args: {
  client: Client;
  instrument: InstrumentRow;
  range: IntradayChartRange;
  now: Date;
}): Promise<RangeLoad> {
  const { client, instrument, range, now } = args;
  const company = await companyForChart(instrument);
  const week52 = await loadWeek52(client, instrument, company, now);

  try {
    const points = await loadIntraday(providerSymbolOf(instrument), range);
    const series = buildRangeSeries({
      range,
      source: "intraday",
      points,
      week52,
    });
    if (series) return { ok: true, series, notice: null };
  } catch (error) {
    console.error("[range-series]", instrument.symbol, describeError(error));
  }

  const closes = await getPriceSeries(
    client,
    instrument.id,
    addDays(isoDate(now), -FALLBACK_DAYS),
  );
  const series = buildRangeSeries({
    range,
    source: "daily",
    points: sliceDaily(range, dailyInput(closes)),
    week52,
  });
  return series
    ? {
        ok: true,
        series,
        notice:
          "Mostramos los cierres diarios: no pudimos traer el detalle del día.",
      }
    : {
        ok: false,
        message: "Todavía no hay datos suficientes para este rango.",
      };
}
