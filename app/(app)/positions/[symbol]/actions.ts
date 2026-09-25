"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/db/auth";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { getInstrumentBySymbol } from "@/lib/portfolio/queries";
import { loadIntradayRange, type RangeLoad } from "@/lib/portfolio/range-data";
import { SYMBOL_PATTERN, normalizeSymbol } from "@/lib/validation/transaction";

export type RangeResponse = RangeLoad;

const input = z.object({
  symbol: z.string().max(40),
  range: z.enum(["1w", "1m"]),
});

const GENERIC =
  "No pudimos traer el gráfico ahora. Probá de nuevo en un momento.";

/**
 * La semana o el mes de un símbolo con barras del día, para el gráfico de la ficha. Llama a Yahoo (con
 * caché de 5 minutos), así que exige sesión y cuenta contra el mismo límite que la búsqueda de
 * símbolos (30 por minuto por usuario). Solo se atienden símbolos que ya están en la base.
 */
export async function getRangeSeries(
  symbol: string,
  range: string,
): Promise<RangeResponse> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) {
    return { ok: false, message: "La sesión venció. Volvé a ingresar." };
  }

  const parsed = input.safeParse({ symbol, range });
  if (!parsed.success) return { ok: false, message: GENERIC };
  const normalized = normalizeSymbol(parsed.data.symbol);
  if (normalized.length > 15 || !SYMBOL_PATTERN.test(normalized)) {
    return { ok: false, message: GENERIC };
  }

  try {
    if (!(await takeRateLimit(supabase, "search_symbols"))) {
      return {
        ok: false,
        message: "Muchas consultas seguidas. Esperá un momento.",
      };
    }
    const instrument = await getInstrumentBySymbol(supabase, normalized);
    if (!instrument) return { ok: false, message: GENERIC };
    return await loadIntradayRange({
      client: supabase,
      instrument,
      range: parsed.data.range,
      now: new Date(),
    });
  } catch (error) {
    console.error("[range-series]", describeError(error));
    return { ok: false, message: GENERIC };
  }
}
