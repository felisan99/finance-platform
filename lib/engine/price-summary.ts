import type { Dec } from "./decimal";
import { sortCloses } from "./series";
import type { DailyClose } from "./valuation";

// Resumen de los cierres de un activo en un rango, para contar "cómo se movió" sin volcar la
// serie entera. Puro.

export interface PriceSummary {
  first: DailyClose;
  last: DailyClose;
  /** El menor cierre (el primero si se repite). */
  min: DailyClose;
  max: DailyClose;
  /** `last / first − 1`; `null` si el primer cierre es 0. */
  change: Dec | null;
  /** Cantidad de cierres en el rango. */
  count: number;
}

/** Cierres con fecha en `[from, to]`. `null` si no hay ninguno. */
export function summarizeCloses(
  closes: readonly DailyClose[],
  from: string,
  to: string,
): PriceSummary | null {
  const inRange = sortCloses(closes).filter(
    (c) => c.date >= from && c.date <= to,
  );
  const first = inRange[0];
  const last = inRange.at(-1);
  if (!first || !last) return null;

  let min = first;
  let max = first;
  for (const close of inRange) {
    if (close.close.lt(min.close)) min = close;
    if (close.close.gt(max.close)) max = close;
  }
  return {
    first,
    last,
    min,
    max,
    change: first.close.isZero() ? null : last.close.div(first.close).minus(1),
    count: inRange.length,
  };
}
