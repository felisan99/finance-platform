"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/db/auth";
import { createAdminClient } from "@/lib/db/admin";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { createClient } from "@/lib/db/server";
import { describeError, getMarketDataProvider } from "@/lib/market-data";
import { createSupabaseMarketStore, refreshQuotes } from "@/lib/market-jobs";
import { backfillPendingInBackground } from "@/lib/portfolio/background";
import { forgetPortfolio } from "@/lib/portfolio/current-portfolio";
import {
  getBenchmarkInstrument,
  getWatchlistItems,
  listPortfolios,
  loadScopeSnapshot,
} from "@/lib/portfolio/queries";
import { benchmarkOfScope } from "@/lib/portfolio/portfolio-scope";
import {
  collectRefreshTargets,
  refreshMessage,
  toQuoteInstruments,
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
    // Todos los portafolios juntos: sus posiciones abiertas, sin repetir símbolos.
    const snapshot =
      portfolios.length > 0
        ? await loadScopeSnapshot(supabase, { kind: "all", portfolios })
        : null;
    // Los benchmarks de cada portafolio y el de «Todo junto». Sin benchmark el resto se actualiza
    // igual: el gráfico solo se queda con los cierres.
    const benchmarkSymbols = new Set(portfolios.map((p) => p.benchmarkSymbol));
    if (portfolios.length > 1) {
      benchmarkSymbols.add(benchmarkOfScope({ kind: "all", portfolios }));
    }
    const benchmarks = await Promise.all(
      [...benchmarkSymbols].map((symbol) =>
        getBenchmarkInstrument(supabase, symbol).catch((error: unknown) => {
          console.error("[refresh-quotes] benchmark", describeError(error));
          return null;
        }),
      ),
    );

    const targets = collectRefreshTargets({
      openSymbols:
        snapshot?.engine.positions
          .filter((p) => p.isOpen)
          .map((p) => p.symbol) ?? [],
      instrumentBySymbol: snapshot?.instrumentBySymbol ?? new Map(),
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

    const result = await refreshQuotes({
      provider: await getMarketDataProvider(),
      store: createSupabaseMarketStore(createAdminClient()),
      instruments: toQuoteInstruments(targets.instruments),
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
