import { z } from "zod";
import { addDays, marketDay } from "@/lib/engine";
import { formatDateKey } from "@/lib/portfolio/chart-format";
import { SYMBOL_PATTERN, normalizeSymbol } from "@/lib/validation/transaction";
import type { ToolResult, ToolSource } from "../tool-result";

// Piezas comunes de las tools. Los esquemas de entrada son simples a propósito (sin transforms):
// el AI SDK los convierte a JSON Schema para el modelo. La normalización y las reglas finas se
// aplican en `execute`, y un dato inválido vuelve como error legible, no como excepción.

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const dateInput = z
  .string()
  .regex(DATE_KEY)
  .describe("Fecha en formato YYYY-MM-DD");

export const symbolInput = z
  .string()
  .min(1)
  .max(20)
  .describe("Símbolo del activo, por ejemplo AAPL, VOO o BTC-USD");

export function ok(
  source: ToolSource,
  data: unknown,
  extra: { missing?: string[]; notes?: string[] } = {},
): ToolResult {
  return {
    ok: true,
    source,
    data,
    missing: extra.missing ?? [],
    notes: extra.notes ?? [],
  };
}

export const fail = (error: string): ToolResult => ({ ok: false, error });

/** `2026-02-30` no es una fecha aunque tenga la forma. */
function isCalendarDate(key: string): boolean {
  if (!DATE_KEY.test(key)) return false;
  const date = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(key);
}

export type RangeCheck =
  | { ok: true; from: string; to: string; clipped: boolean }
  | { ok: false; error: string };

/**
 * Valida un rango pedido por el modelo: fechas reales, `desde ≤ hasta`, y `hasta` no posterior a
 * hoy (si lo es, se recorta y se avisa). Hoy es el día de mercado de `now`.
 */
export function checkRange(from: string, to: string, now: Date): RangeCheck {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    return { ok: false, error: "Fecha inválida: usá el formato YYYY-MM-DD." };
  }
  if (from > to) {
    return {
      ok: false,
      error: "La fecha de inicio es posterior a la de fin.",
    };
  }
  const today = marketDay(now);
  if (from > today) {
    return { ok: false, error: "El rango empieza en el futuro." };
  }
  return to > today
    ? { ok: true, from, to: today, clipped: true }
    : { ok: true, from, to, clipped: false };
}

/** El cierre "de partida" de un rango que empieza en `from`: el del día anterior. */
export const startCloseOf = (from: string): string => addDays(from, -1);

export type SymbolCheck =
  { ok: true; symbol: string } | { ok: false; error: string };

/** `brk.b` → `BRK-B`, como en los formularios. */
export function checkSymbol(raw: string): SymbolCheck {
  const symbol = normalizeSymbol(raw);
  return symbol.length > 0 && symbol.length <= 15 && SYMBOL_PATTERN.test(symbol)
    ? { ok: true, symbol }
    : { ok: false, error: `"${raw}" no es un símbolo válido.` };
}

export const rangeText = (from: string, to: string): string =>
  `${formatDateKey(from)} – ${formatDateKey(to)}`;
