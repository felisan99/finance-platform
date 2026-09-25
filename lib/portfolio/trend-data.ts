import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { addDays, isoDate } from "@/lib/market-jobs/dates";
import { getWatchlistMarket } from "./queries";
import type { PortfolioSnapshot } from "./snapshot";
import {
  TREND_POINTS,
  buildTrendRows,
  pickTrendPositions,
  type TrendRowView,
} from "./trend-view";

/** Ventana de lectura del RPC: de sobra para 22 ruedas (el RPC devuelve las últimas `TREND_POINTS`). */
const SINCE_DAYS = 60;

/**
 * Las posiciones más grandes con los cierres del último mes. Una sola lectura (el RPC
 * `watchlist_market` de la Watchlist, que sirve para cualquier instrumento); si no hay posiciones
 * abiertas con precio no toca la base.
 */
export async function loadPositionTrends(
  client: SupabaseClient<Database>,
  snapshot: PortfolioSnapshot,
  now: Date,
): Promise<TrendRowView[]> {
  const positions = pickTrendPositions(snapshot.valued);
  if (positions.length === 0) return [];
  const ids = positions.flatMap((p) => {
    const id = snapshot.instrumentBySymbol.get(p.symbol)?.id;
    return id ? [id] : [];
  });
  const market = ids.length
    ? await getWatchlistMarket(
        client,
        ids,
        addDays(isoDate(now), -SINCE_DAYS),
        TREND_POINTS,
      )
    : [];
  return buildTrendRows(
    positions,
    snapshot.instrumentBySymbol,
    new Map(market.map((row) => [row.instrument_id, row])),
  );
}
