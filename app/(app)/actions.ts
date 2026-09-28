"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/db/auth";
import { createAdminClient } from "@/lib/db/admin";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { createClient } from "@/lib/db/server";
import { describeError, getMarketDataProvider } from "@/lib/market-data";
import {
  createSupabaseMarketStore,
  refreshQuotes,
  type ActiveInstrument,
} from "@/lib/market-jobs";
import { backfillPendingInBackground } from "@/lib/portfolio/background";
import { forgetPortfolio } from "@/lib/portfolio/current-portfolio";
import {
  getBenchmarkInstrument,
  getWatchlistItems,
  listPortfolios,
  loadPortfolioSnapshot,
} from "@/lib/portfolio/queries";
import {
  collectRefreshTargets,
  refreshMessage,
} from "@/lib/portfolio/refresh-targets";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  await forgetPortfolio();
  redirect("/login");
}

export type RefreshState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

/**
 * "Actualizar precios" (spec §7.2): refresca `quotes_latest` solo de las posiciones abiertas del
 * usuario (de todos sus portafolios: el límite de 5 minutos no deja actualizar uno por uno), de los
 * símbolos de su watchlist y de los benchmarks (el gráfico de rendimiento compara contra ellos), a lo
 * sumo una vez cada 5 minutos por usuario (el límite lo aplica la base). Escribir en `quotes_latest`
 * requiere la clave secreta: por eso el usuario no la toca directamente.
 */
export async function refreshQuotesAction(): Promise<RefreshState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  try {
    if (!(await takeRateLimit(supabase, "refresh_quotes"))) {
      return {
        status: "error",
        message: "Ya actualizaste hace poco. Volvé a probar en unos minutos.",
      };
    }

    const [portfolios, followed] = await Promise.all([
      listPortfolios(supabase),
      getWatchlistItems(supabase),
    ]);
    const snapshots = await Promise.all(
      portfolios.map((portfolio) => loadPortfolioSnapshot(supabase, portfolio)),
    );
    // Sin benchmark el resto se actualiza igual: el gráfico solo se queda con los cierres.
    const benchmarks = await Promise.all(
      [...new Set(portfolios.map((p) => p.benchmarkSymbol))].map((symbol) =>
        getBenchmarkInstrument(supabase, symbol).catch((error: unknown) => {
          console.error("[refresh-quotes] benchmark", describeError(error));
          return null;
        }),
      ),
    );

    const targets = collectRefreshTargets({
      openSymbols: snapshots.flatMap((snapshot) =>
        snapshot.engine.positions.filter((p) => p.isOpen).map((p) => p.symbol),
      ),
      instrumentBySymbol: new Map(
        snapshots.flatMap((snapshot) => [...snapshot.instrumentBySymbol]),
      ),
      followed: followed.map((item) => item.instruments),
      benchmarks: benchmarks.filter((b) => b !== null),
    });
    if (targets.instruments.length === 0) {
      return {
        status: "ok",
        message:
          "No hay posiciones abiertas ni símbolos seguidos para actualizar.",
      };
    }

    const instruments: ActiveInstrument[] = targets.instruments.map(
      (instrument) => ({
        id: instrument.id,
        symbol: instrument.symbol,
        providerSymbol: instrument.provider_symbol,
        historyBackfilledAt: null,
        historyFrom: null,
        firstTxDate: null,
        inWatchlist: false,
        latestPriceDate: null,
      }),
    );

    const result = await refreshQuotes({
      provider: await getMarketDataProvider(),
      store: createSupabaseMarketStore(createAdminClient()),
      instruments,
    });
    // La cotización ya está; el historial de una posición nueva se completa en segundo plano.
    backfillPendingInBackground("refresh-backfill");
    revalidatePath("/", "layout");

    return {
      status: "ok",
      message: refreshMessage(result, targets.extraBenchmarks),
    };
  } catch (error) {
    console.error("[refresh-quotes]", describeError(error));
    return {
      status: "error",
      message:
        "No pudimos actualizar los precios ahora. Probá de nuevo en un rato.",
    };
  }
}
