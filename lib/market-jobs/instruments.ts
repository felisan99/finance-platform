import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "@/lib/db/paginate";
import type { Database } from "@/lib/db/database.types";
import { MarketDataError, type MarketDataProvider } from "@/lib/market-data";
import { cleanText } from "@/lib/market-data/sanitize";
import { SYMBOL_PATTERN } from "@/lib/validation/transaction";

// Alta de instrumentos. `instruments` es una tabla compartida que los usuarios no pueden escribir:
// la crea el servidor con la clave secreta (`createAdminClient`), que es uno de los pocos usos
// permitidos (CLAUDE.md). Nunca se le pasa un símbolo sin validar.

export interface NewInstrument {
  symbol: string;
  name: string | null;
  type: "STOCK" | "ETF";
}

/** Tope por llamada: una importación no puede llenar la tabla compartida de símbolos. */
export const MAX_NEW_INSTRUMENTS = 200;
const LOOKUP_CHUNK = 100;

/**
 * Crea los instrumentos que no existan y devuelve `símbolo → id` de TODOS los pedidos (los que ya
 * estaban y los nuevos). Los existentes no se tocan: no se pisa lo que cargó el proveedor.
 */
export async function ensureInstruments(
  admin: SupabaseClient<Database>,
  instruments: readonly NewInstrument[],
): Promise<Map<string, string>> {
  const bySymbol = new Map<string, NewInstrument>();
  for (const instrument of instruments) {
    if (
      !SYMBOL_PATTERN.test(instrument.symbol) ||
      instrument.symbol.length > 15
    ) {
      throw new Error(`Símbolo inválido: ${instrument.symbol.slice(0, 20)}`);
    }
    if (!bySymbol.has(instrument.symbol))
      bySymbol.set(instrument.symbol, instrument);
  }
  if (bySymbol.size > MAX_NEW_INSTRUMENTS) {
    throw new Error(
      `Demasiados instrumentos distintos (máximo ${MAX_NEW_INSTRUMENTS})`,
    );
  }
  if (bySymbol.size === 0) return new Map();

  const { error } = await admin.from("instruments").upsert(
    [...bySymbol.values()].map((i) => ({
      symbol: i.symbol,
      name: cleanText(i.name, 120),
      type: i.type,
    })),
    { onConflict: "symbol", ignoreDuplicates: true },
  );
  if (error) throw new Error(`db ensureInstruments: ${error.message}`);

  const ids = new Map<string, string>();
  for (const group of chunk([...bySymbol.keys()], LOOKUP_CHUNK)) {
    const { data, error: readError } = await admin
      .from("instruments")
      .select("id, symbol")
      .in("symbol", group);
    if (readError)
      throw new Error(`db ensureInstruments: ${readError.message}`);
    for (const row of data) ids.set(row.symbol, row.id);
  }
  for (const symbol of bySymbol.keys()) {
    if (!ids.has(symbol))
      throw new Error(`No se pudo crear el instrumento ${symbol}`);
  }
  return ids;
}

export type ResolveResult =
  | { ok: true; instrument: NewInstrument }
  | {
      ok: false;
      reason: "NOT_FOUND" | "UNSUPPORTED" | "UNAVAILABLE";
      message: string;
    };

/**
 * Verifica un símbolo NUEVO contra el proveedor antes de crearlo (alta manual): tiene que existir,
 * ser una acción o ETF y cotizar en USD. Así un error de tipeo no llena la tabla compartida.
 */
export async function resolveNewInstrument(
  provider: MarketDataProvider,
  symbol: string,
): Promise<ResolveResult> {
  const fail = (
    reason: "NOT_FOUND" | "UNSUPPORTED" | "UNAVAILABLE",
    message: string,
  ): ResolveResult => ({ ok: false, reason, message });

  if (!SYMBOL_PATTERN.test(symbol) || symbol.length > 15) {
    return fail("NOT_FOUND", "Símbolo inválido");
  }
  try {
    const [quote] = await provider.getQuotes([symbol]);
    if (!quote || quote.symbol.toUpperCase() !== symbol) {
      return fail("NOT_FOUND", `No encontramos el símbolo ${symbol}`);
    }
    if (quote.currency !== null && quote.currency !== "USD") {
      return fail(
        "UNSUPPORTED",
        "Por ahora solo se admiten instrumentos en USD",
      );
    }
    const profile = provider.getProfile
      ? await provider.getProfile(symbol)
      : null;
    if (!profile?.type) {
      return fail("UNSUPPORTED", "Por ahora solo se admiten acciones y ETFs");
    }
    if (profile.currency !== null && profile.currency !== "USD") {
      return fail(
        "UNSUPPORTED",
        "Por ahora solo se admiten instrumentos en USD",
      );
    }
    return {
      ok: true,
      instrument: { symbol, name: profile.name, type: profile.type },
    };
  } catch (error) {
    if (error instanceof MarketDataError && error.kind === "NOT_FOUND") {
      return fail("NOT_FOUND", `No encontramos el símbolo ${symbol}`);
    }
    return fail(
      "UNAVAILABLE",
      "No pudimos verificar el símbolo ahora; probá de nuevo en un momento",
    );
  }
}
