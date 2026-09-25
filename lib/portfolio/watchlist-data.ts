import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { addDays, isoDate } from "@/lib/market-jobs/dates";
import { getQuoteRows, getWatchlistItems, getWatchlistMarket } from "./queries";
import type { InstrumentRow } from "./rows";
import {
  RANGE_DAYS,
  SPARK_POINTS,
  buildWatchlistRow,
  buildWatchlistView,
  type WatchlistRowView,
} from "./watchlist";

type Client = SupabaseClient<Database>;

/** Desde cuándo se mira el rango de "52 semanas". */
const rangeStart = (now: Date) => addDays(isoDate(now), -RANGE_DAYS);

/** La watchlist completa de la persona, en orden alfabético. Tres lecturas, dos en paralelo. */
export async function loadWatchlist(
  client: Client,
  now: Date,
): Promise<WatchlistRowView[]> {
  const items = await getWatchlistItems(client);
  if (items.length === 0) return [];
  const ids = items.map((item) => item.instruments.id);

  const [market, quotes] = await Promise.all([
    getWatchlistMarket(client, ids, rangeStart(now), SPARK_POINTS),
    getQuoteRows(client, ids),
  ]);
  const marketById = new Map(market.map((row) => [row.instrument_id, row]));
  const quoteById = new Map(quotes.map((row) => [row.instrument_id, row]));

  return buildWatchlistView(
    items.map(({ instruments: instrument }) => ({
      instrument,
      quote: quoteById.get(instrument.id) ?? null,
      market: marketById.get(instrument.id) ?? null,
    })),
  );
}

/** Lo mismo para un solo instrumento (el detalle de un símbolo que se sigue pero no se tiene). */
export async function loadSymbolView(
  client: Client,
  instrument: InstrumentRow,
  now: Date,
): Promise<WatchlistRowView> {
  const [market, quotes] = await Promise.all([
    getWatchlistMarket(client, [instrument.id], rangeStart(now), SPARK_POINTS),
    getQuoteRows(client, [instrument.id]),
  ]);
  return buildWatchlistRow({
    instrument,
    quote: quotes[0] ?? null,
    market: market[0] ?? null,
  });
}
