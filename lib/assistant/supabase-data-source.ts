import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { d } from "@/lib/engine";
import { loadBeforeBuy } from "@/lib/portfolio/before-buy-data";
import { loadPerformanceData } from "@/lib/portfolio/performance-data";
import {
  scopeName,
  type PortfolioScope,
} from "@/lib/portfolio/portfolio-scope";
import {
  getInstrumentBySymbol,
  getPriceSeries,
  loadScopeSnapshot,
} from "@/lib/portfolio/queries";
import { once, type AssistantDataSource } from "./data-source";

/**
 * Las lecturas del asistente con el cliente de la sesión: RLS deja ver solo los datos de quien
 * pregunta. Nunca con `lib/db/admin.ts`. El snapshot y el rendimiento se leen una sola vez por
 * pregunta aunque varias tools los usen.
 */
export function supabaseDataSource(
  client: SupabaseClient<Database>,
  scope: PortfolioScope,
  now: Date,
): AssistantDataSource {
  const snapshot = once(() => loadScopeSnapshot(client, scope));
  const performance = once(async () =>
    loadPerformanceData(client, await snapshot()),
  );

  return {
    now,
    scopeName: scopeName(scope),
    snapshot,
    performance,
    async priceHistory(symbol, from) {
      const instrument = await getInstrumentBySymbol(client, symbol);
      if (!instrument) return null;
      const rows = await getPriceSeries(client, instrument.id, from);
      return {
        symbol: instrument.symbol,
        name: instrument.name,
        closes: rows.map((row) => ({ date: row.date, close: d(row.close) })),
      };
    },
    async beforeBuy(symbol) {
      const instrument = await getInstrumentBySymbol(client, symbol);
      if (!instrument) return null;
      return loadBeforeBuy(client, {
        snapshot: await snapshot(),
        instrument,
        now,
      });
    },
  };
}
