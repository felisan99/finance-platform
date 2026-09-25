import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { takeRateLimit } from "@/lib/db/rate-limit";
import type { createClient } from "@/lib/db/server";
import { getMarketDataProvider } from "@/lib/market-data";
import {
  ensureInstruments,
  resolveNewInstrument,
} from "@/lib/market-jobs/instruments";
import { getInstrumentIdsBySymbol } from "./queries";

export type ResolvedInstrument =
  { ok: true; id: string } | { ok: false; message: string };

/**
 * Trae el símbolo de la base o, si es nuevo, lo verifica con el proveedor y lo da de alta (con la
 * clave secreta: `instruments` no es escribible por usuarios). Verificar un símbolo nuevo llama a
 * Yahoo, así que cuenta contra el límite de búsquedas. Lo usan el alta de operaciones y la
 * watchlist: la misma verificación y el mismo límite en los dos lados.
 */
export async function resolveInstrumentId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  symbol: string,
): Promise<ResolvedInstrument> {
  const known = (await getInstrumentIdsBySymbol(supabase, [symbol])).get(
    symbol,
  );
  if (known) return { ok: true, id: known };

  if (!(await takeRateLimit(supabase, "search_symbols"))) {
    return {
      ok: false,
      message:
        "Demasiados intentos seguidos. Esperá un minuto y probá de nuevo.",
    };
  }
  const resolved = await resolveNewInstrument(
    await getMarketDataProvider(),
    symbol,
  );
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const ids = await ensureInstruments(createAdminClient(), [
    resolved.instrument,
  ]);
  const id = ids.get(symbol);
  return id
    ? { ok: true, id }
    : {
        ok: false,
        message:
          "No pudimos guardar los cambios. Probá de nuevo en un momento.",
      };
}
