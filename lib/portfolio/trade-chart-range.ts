// Rangos del gráfico "Tus operaciones" de la ficha de un activo. Sin imports a propósito: lo usa el
// componente de cliente para recortar la serie sin volver a pedirla (el servidor manda hasta 5 años
// de cierres una sola vez) y no tiene que arrastrar el motor al navegador.

export type TradeChartRange = "since" | "1m" | "3m" | "1y" | "5y";

export const TRADE_RANGE_OPTIONS: ReadonlyArray<{
  id: TradeChartRange;
  text: string;
}> = [
  { id: "since", text: "Desde tu compra" },
  { id: "1m", text: "1M" },
  { id: "3m", text: "3M" },
  { id: "1y", text: "1A" },
  { id: "5y", text: "5A" },
];

const MONTHS: Record<Exclude<TradeChartRange, "since">, number> = {
  "1m": 1,
  "3m": 3,
  "1y": 12,
  "5y": 60,
};

/** `YYYY-MM-DD` menos `months` meses; si el día no existe en ese mes, el último del mes. */
export function monthsBefore(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const total = year * 12 + month - months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const iso = new Date(
    Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)),
  );
  return iso.toISOString().slice(0, 10);
}

/**
 * Primer día que muestra el rango. "Desde tu compra" usa `sinceStart` (unos días antes de la
 * primera operación); sin operaciones no aplica y devuelve `null`.
 */
export function rangeStart(
  range: TradeChartRange,
  end: string,
  sinceStart: string | null,
): string | null {
  return range === "since" ? sinceStart : monthsBefore(end, MONTHS[range]);
}

/** El rango con el que abre: "Desde tu compra" si hay operaciones; si no, un año. */
export const defaultTradeRange = (
  sinceStart: string | null,
): TradeChartRange => (sinceStart === null ? "1y" : "since");

export interface RangeSlice<P, M> {
  points: P[];
  markers: M[];
  /** Operaciones anteriores al rango: no se dibujan, se avisa cuántas son. */
  hiddenBefore: number;
}

/** Los puntos y las operaciones del rango (la serie y los marcadores vienen en orden de fecha). */
export function sliceByRange<
  P extends { date: string },
  M extends { date: string },
>(
  points: readonly P[],
  markers: readonly M[],
  range: TradeChartRange,
  sinceStart: string | null,
): RangeSlice<P, M> {
  const end = points.at(-1)?.date;
  const start = end ? rangeStart(range, end, sinceStart) : null;
  if (start === null) {
    return { points: [...points], markers: [...markers], hiddenBefore: 0 };
  }
  return {
    points: points.filter((p) => p.date >= start),
    markers: markers.filter((m) => m.date >= start),
    hiddenBefore: markers.filter((m) => m.date < start).length,
  };
}

/** Más de un año a la vista: el eje muestra mes y año (`03/25`); si no, día y mes (`19/03`). */
export function tickFormatFor(
  first: string | undefined,
  last: string | undefined,
): (date: string) => string {
  const long =
    first !== undefined &&
    last !== undefined &&
    Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`) >
      400 * 86_400_000;
  return long
    ? (date) => `${date.slice(5, 7)}/${date.slice(2, 4)}`
    : (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
