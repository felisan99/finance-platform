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
import { loadPortfolioSnapshot } from "@/lib/portfolio/queries";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type RefreshState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

/**
 * "Actualizar precios" (spec §7.2): refresca `quotes_latest` solo de las posiciones abiertas del
 * usuario, a lo sumo una vez cada 5 minutos por usuario (el límite lo aplica la base). Escribir en
 * `quotes_latest` requiere la clave secreta: por eso el usuario no la toca directamente.
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

    const snapshot = await loadPortfolioSnapshot(supabase);
    const openSymbols =
      snapshot?.engine.positions.filter((p) => p.isOpen).map((p) => p.symbol) ??
      [];
    if (!snapshot || openSymbols.length === 0) {
      return {
        status: "ok",
        message: "No hay posiciones abiertas para actualizar.",
      };
    }

    const instruments: ActiveInstrument[] = openSymbols.flatMap((symbol) => {
      const instrument = snapshot.instrumentBySymbol.get(symbol);
      return instrument
        ? [
            {
              id: instrument.id,
              symbol: instrument.symbol,
              providerSymbol: instrument.provider_symbol,
              historyBackfilledAt: null,
              historyFrom: null,
              firstTxDate: null,
              inWatchlist: false,
              latestPriceDate: null,
            },
          ]
        : [];
    });

    const result = await refreshQuotes({
      provider: await getMarketDataProvider(),
      store: createSupabaseMarketStore(createAdminClient()),
      instruments,
    });
    // La cotización ya está; el historial de una posición nueva se completa en segundo plano.
    backfillPendingInBackground("refresh-backfill");
    revalidatePath("/", "layout");

    if (result.missing.length > 0) {
      return {
        status: "ok",
        message: `Actualizado (${result.updated}). Sin cotización: ${result.missing.join(", ")}.`,
      };
    }
    return {
      status: "ok",
      message: `Precios actualizados (${result.updated}).`,
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
