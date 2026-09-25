import { z } from "zod";
import { SYMBOL_PATTERN, normalizeSymbol } from "./transaction";

/** El símbolo del formulario de la watchlist: se normaliza igual que en las operaciones (`brk.b` → `BRK-B`). */
const symbolSchema = z
  .string()
  .max(40, "Símbolo demasiado largo")
  .transform(normalizeSymbol)
  .pipe(
    z
      .string()
      .min(1, "Escribí un símbolo")
      .max(15, "Símbolo demasiado largo")
      .regex(
        SYMBOL_PATTERN,
        "Símbolo inválido: letras y números (para clases usá guion, como BRK-B)",
      ),
  );

export type WatchlistSymbolResult =
  { ok: true; symbol: string } | { ok: false; message: string };

/** Valida lo que llega del formulario (`FormDataEntryValue | null`): nunca lanza. */
export function parseWatchlistSymbol(raw: unknown): WatchlistSymbolResult {
  if (typeof raw !== "string")
    return { ok: false, message: "Escribí un símbolo" };
  const parsed = symbolSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, symbol: parsed.data }
    : {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Símbolo inválido",
      };
}
