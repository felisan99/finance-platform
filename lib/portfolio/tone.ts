import type { Dec } from "@/lib/engine";

export type Tone = "gain" | "loss" | "flat";

/** Signo de un valor tal como se ve: lo que redondea a cero es "sin cambio" (ni ▲ ni ▼). */
export function toneOf(value: Dec | null, decimals: number): Tone | null {
  if (value === null) return null;
  const rounded = value.toDecimalPlaces(decimals);
  if (rounded.isZero()) return "flat";
  return rounded.gt(0) ? "gain" : "loss";
}
