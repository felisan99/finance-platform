import { z } from "zod";
import { PORTFOLIO_NAME_MAX } from "@/lib/validation/portfolio";

// El portafolio que pide un widget: lo que la persona escribió en el campo «Parameter» del widget
// de Scriptable, que el script manda como `?portfolio=`. No es secreto (es un nombre); lo que
// decide si corresponde es `widget_ledger`.

export const PORTFOLIO_PARAM = "portfolio";

const nameSchema = z.string().trim().max(PORTFOLIO_NAME_MAX);

/**
 * `name: null` si no vino o vino vacío (lo que eligió el código). `ok: false` si es más largo que
 * cualquier nombre de portafolio: no puede corresponder a ninguno.
 */
export function readPortfolioParam(
  url: string,
): { ok: true; name: string | null } | { ok: false } {
  const raw = new URL(url).searchParams.get(PORTFOLIO_PARAM);
  if (raw === null) return { ok: true, name: null };
  const parsed = nameSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  return { ok: true, name: parsed.data === "" ? null : parsed.data };
}
