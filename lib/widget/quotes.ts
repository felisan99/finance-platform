import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { chunk } from "@/lib/db/paginate";
import type { Database } from "@/lib/db/database.types";
import {
  describeError,
  getMarketDataProvider,
  type MarketDataProvider,
} from "@/lib/market-data";
import { createSupabaseMarketStore, refreshQuotes } from "@/lib/market-jobs";
import { toQuoteInstruments } from "@/lib/portfolio/refresh-targets";
import { parseRows } from "@/lib/portfolio/rows";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import {
  QUOTE_REFRESH_TIMEOUT_MS,
  staleQuoteIds,
  withTimeout,
} from "./freshness";

// Cotizaciones a demanda para el widget (docs/decisions.md, "Widget de iPhone"): el cron de Vercel
// corre una vez por día, así que el widget pide a Yahoo las cotizaciones de sus posiciones abiertas
// que se pidieron hace 2 horas o más (una sola llamada para todas). `quotes_latest` es compartida:
// lo que pide un widget le sirve a todos. Escribir cotizaciones es trabajo del sistema (clave
// secreta), como en «Actualizar precios».

export interface WidgetQuoteDeps {
  provider: () => Promise<MarketDataProvider>;
  timeoutMs: number;
}

export const defaultQuoteDeps: WidgetQuoteDeps = {
  provider: () => getMarketDataProvider(),
  timeoutMs: QUOTE_REFRESH_TIMEOUT_MS,
};

const fetchedAtRowSchema = z.object({
  instrument_id: z.string(),
  fetched_at: z.string().nullable(),
});

async function getQuoteFetchedAt(
  admin: SupabaseClient<Database>,
  ids: readonly string[],
): Promise<Map<string, Date | null>> {
  const rows: unknown[] = [];
  for (const group of chunk(ids, 100)) {
    const { data, error } = await admin
      .from("quotes_latest")
      .select("instrument_id, fetched_at")
      .in("instrument_id", group);
    if (error) throw new Error(`db quotes_latest: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return new Map(
    parseRows(fetchedAtRowSchema, rows, "quotes_latest").map((row) => [
      row.instrument_id,
      row.fetched_at === null ? null : new Date(row.fetched_at),
    ]),
  );
}

/**
 * Pide las cotizaciones viejas de las posiciones abiertas del snapshot. `true` si guardó alguna
 * (hay que volver a armar el snapshot). Nunca lanza: si algo falla o Yahoo tarda, el widget
 * muestra lo guardado. Un intento por código cada 10 minutos (`take_widget_quote_refresh`), para
 * que una falla de Yahoo no se reintente en cada consulta.
 */
export async function refreshStaleQuotes(
  admin: SupabaseClient<Database>,
  tokenHash: string,
  snapshot: PortfolioSnapshot,
  now: Date,
  deps: WidgetQuoteDeps = defaultQuoteDeps,
): Promise<boolean> {
  try {
    const instruments = snapshot.engine.positions.flatMap((position) => {
      const instrument = position.isOpen
        ? snapshot.instrumentBySymbol.get(position.symbol)
        : undefined;
      return instrument ? [instrument] : [];
    });
    if (instruments.length === 0) return false;

    const ids = instruments.map((instrument) => instrument.id);
    const stale = new Set(
      staleQuoteIds(ids, await getQuoteFetchedAt(admin, ids), now),
    );
    if (stale.size === 0) return false;

    const { data: allowed, error } = await admin.rpc(
      "take_widget_quote_refresh",
      { p_token_hash: tokenHash },
    );
    if (error)
      throw new Error(`db take_widget_quote_refresh: ${error.message}`);
    if (allowed !== true) return false;

    const result = await withTimeout(
      deps.provider().then((provider) =>
        refreshQuotes({
          provider,
          store: createSupabaseMarketStore(admin),
          instruments: toQuoteInstruments(
            instruments.filter((instrument) => stale.has(instrument.id)),
          ),
        }),
      ),
      deps.timeoutMs,
    );
    if (result === null) {
      console.error(
        "[widget] cotizaciones: el proveedor no respondió a tiempo",
      );
      return false;
    }
    return result.updated > 0;
  } catch (error) {
    console.error("[widget] cotizaciones", describeError(error));
    return false;
  }
}
