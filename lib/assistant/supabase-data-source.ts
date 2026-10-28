import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { d } from "@/lib/engine";
import {
  MarketDataError,
  describeError,
  getMarketDataProvider,
  type InstrumentType,
} from "@/lib/market-data";
import { loadBeforeBuy } from "@/lib/portfolio/before-buy-data";
import {
  kindOf,
  loadCompanyData,
  providerSymbolOf,
} from "@/lib/portfolio/company-data";
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
import { once, type AssetInfo, type AssistantDataSource } from "./data-source";

const instrumentType = (type: string | null): InstrumentType | null =>
  type === "STOCK" || type === "ETF" || type === "CRYPTO" ? type : null;

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
    // Cualquier símbolo, esté o no en la base: solo consulta al proveedor (datos públicos, sin
    // guardar nada) y cuenta contra el mismo límite que la búsqueda de símbolos.
    async assetInfo(symbol) {
      if (!(await takeRateLimit(client, "search_symbols"))) {
        return { status: "limited" };
      }
      try {
        const provider = await getMarketDataProvider();
        const known = await getInstrumentBySymbol(client, symbol);
        let base: Omit<AssetInfo, "quote" | "company">;
        if (known) {
          base = {
            symbol,
            name: known.name,
            type: instrumentType(known.type),
            sector: known.sector,
            industry: null,
          };
        } else {
          if (!provider.getProfile) return { status: "unavailable" };
          const profile = await provider.getProfile(symbol);
          // Futuros, índices, monedas: la app no los maneja.
          if (profile.type === null) return { status: "not_found" };
          base = {
            symbol,
            name: profile.name,
            type: profile.type,
            sector: profile.sector,
            industry: profile.industry,
          };
        }
        const providerSymbol = known ? providerSymbolOf(known) : symbol;
        const [quotes, company] = await Promise.all([
          provider.getQuotes([providerSymbol]),
          loadCompanyData(providerSymbol, kindOf({ type: base.type })),
        ]);
        const quote =
          quotes.find((q) => q.symbol === providerSymbol.toUpperCase()) ?? null;
        return { status: "ok", info: { ...base, quote, company } };
      } catch (error) {
        if (
          error instanceof MarketDataError &&
          (error.kind === "NOT_FOUND" || error.kind === "BAD_REQUEST")
        ) {
          return { status: "not_found" };
        }
        console.error("[assistant] asset info", describeError(error));
        return { status: "unavailable" };
      }
    },
  };
}
