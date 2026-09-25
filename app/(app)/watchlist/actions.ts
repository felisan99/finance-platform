"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { backfillPendingInBackground } from "@/lib/portfolio/background";
import { resolveInstrumentId } from "@/lib/portfolio/instruments";
import {
  getInstrumentIdsBySymbol,
  getWatchlistId,
  getWatchlistItems,
} from "@/lib/portfolio/queries";
import { WATCHLIST_MAX } from "@/lib/portfolio/watchlist";
import { parseWatchlistSymbol } from "@/lib/validation/watchlist";

export type WatchlistState =
  | { status: "idle" }
  /** `at` cambia en cada éxito: el formulario lo usa para vaciar el campo. */
  | { status: "ok"; message: string; at: number }
  | { status: "error"; message: string };

const GENERIC = "No pudimos guardar los cambios. Probá de nuevo en un momento.";
const capMessage = `La watchlist admite hasta ${WATCHLIST_MAX} símbolos. Quitá alguno para agregar otro.`;

/** Seguir un símbolo (spec §10.4): lo verifica igual que en una operación y arma la lista. */
export async function addToWatchlist(
  _previous: WatchlistState,
  formData: FormData,
): Promise<WatchlistState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const parsed = parseWatchlistSymbol(formData.get("symbol"));
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { symbol } = parsed;

  try {
    const followed = await getWatchlistItems(supabase);
    if (followed.some((item) => item.instruments.symbol === symbol)) {
      return { status: "error", message: `Ya seguís ${symbol}.` };
    }
    // El límite también lo aplica un trigger; acá se evita dar de alta el símbolo para nada.
    if (followed.length >= WATCHLIST_MAX) {
      return { status: "error", message: capMessage };
    }

    const watchlistId = await getWatchlistId(supabase);
    if (!watchlistId) {
      console.error("[watchlist-add] el usuario no tiene watchlist");
      return { status: "error", message: GENERIC };
    }

    const resolved = await resolveInstrumentId(supabase, symbol);
    if (!resolved.ok) return { status: "error", message: resolved.message };

    const { error } = await supabase.from("watchlist_items").insert({
      watchlist_id: watchlistId,
      instrument_id: resolved.id,
      user_id: user.id,
    });
    if (error) {
      // 23505: ya estaba (dos toques seguidos); 23514: el trigger del tope (dos altas a la vez).
      if (error.code === "23505") {
        return { status: "error", message: `Ya seguís ${symbol}.` };
      }
      if (error.code === "23514") {
        return { status: "error", message: capMessage };
      }
      console.error("[watchlist-add]", error.code, error.message);
      return { status: "error", message: GENERIC };
    }
  } catch (error) {
    console.error("[watchlist-add]", describeError(error));
    return { status: "error", message: GENERIC };
  }

  // Un símbolo nuevo no tiene precios todavía: se descargan sin hacer esperar a la persona.
  backfillPendingInBackground("watchlist-backfill");
  revalidatePath("/", "layout");
  return {
    status: "ok",
    message: `Ahora seguís ${symbol}. El precio y el historial se descargan en unos segundos: actualizá la página.`,
    at: Date.now(),
  };
}

/** Dejar de seguir un símbolo. Quitar uno que ya no está no es un error. */
export async function removeFromWatchlist(
  _previous: WatchlistState,
  formData: FormData,
): Promise<WatchlistState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const parsed = parseWatchlistSymbol(formData.get("symbol"));
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { symbol } = parsed;

  try {
    const id = (await getInstrumentIdsBySymbol(supabase, [symbol])).get(symbol);
    if (id) {
      // RLS limita el borrado a las filas de la persona.
      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("instrument_id", id);
      if (error) {
        console.error("[watchlist-remove]", error.code, error.message);
        return { status: "error", message: GENERIC };
      }
    }
  } catch (error) {
    console.error("[watchlist-remove]", describeError(error));
    return { status: "error", message: GENERIC };
  }

  revalidatePath("/", "layout");
  // Desde el detalle de un símbolo que no se tiene, esa página deja de existir: se vuelve a la lista.
  if (formData.get("next") === "watchlist") redirect("/watchlist");
  return {
    status: "ok",
    message: `Dejaste de seguir ${symbol}.`,
    at: Date.now(),
  };
}
