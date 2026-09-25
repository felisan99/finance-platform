import { D } from "@/lib/engine/decimal";

/** Redondea a `decimals` lugares (ROUND_HALF_UP) y devuelve el string sin ceros de relleno. */
export function round(value: number, decimals: number): string {
  const text = new D(value)
    .toDecimalPlaces(decimals, D.ROUND_HALF_UP)
    .toFixed();
  return text === "-0" ? "0" : text;
}
