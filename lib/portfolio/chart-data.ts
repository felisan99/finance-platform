import { marketDay, type Transaction } from "@/lib/engine";

// Datos del gráfico de precio de una posición (spec §10.2): la serie de cierres con marcadores de
// compra y venta. Es SOLO para mostrar: los números salen del decimal a `number` porque el gráfico
// los dibuja, no los calcula. La serie de cierres viene ajustada por splits hacia atrás, así que
// un marcador va sobre el cierre de su día, no sobre el precio de la operación.

export interface ChartPoint {
  date: string;
  close: number;
}

export interface ChartMarker {
  date: string;
  /** Cierre de esa fecha: donde se dibuja el marcador. */
  close: number;
  type: "BUY" | "SELL";
  quantity: string;
  price: string;
}

export interface PositionChartData {
  points: ChartPoint[];
  markers: ChartMarker[];
  /** Línea de referencia; `null` si la posición está cerrada. */
  avgCost: number | null;
}

/** Fecha de la rueda (YYYY-MM-DD, hora de Nueva York) en la que cae una operación. */
export const tradeDay = marketDay;

/** La barra de esa fecha o, si no hay (feriado, dato faltante), la anterior más cercana. */
function barOnOrBefore(
  points: readonly ChartPoint[],
  date: string,
): ChartPoint | null {
  let found: ChartPoint | null = null;
  for (const point of points) {
    if (point.date > date) break;
    found = point;
  }
  return found;
}

export function buildPositionChart(
  series: ReadonlyArray<{ date: string; close: string }>,
  transactions: readonly Transaction[],
  symbol: string,
  avgCost: string | null,
): PositionChartData {
  const points = series
    .map((p) => ({ date: p.date, close: Number(p.close) }))
    .filter((p) => Number.isFinite(p.close));

  const markers: ChartMarker[] = [];
  for (const tx of transactions) {
    if ((tx.type !== "BUY" && tx.type !== "SELL") || tx.symbol !== symbol)
      continue;
    const bar = barOnOrBefore(points, tradeDay(tx.executedAt));
    if (!bar) continue; // anterior al inicio de la serie: no hay dónde ponerlo
    markers.push({
      date: bar.date,
      close: bar.close,
      type: tx.type,
      quantity: tx.quantity.toFixed(),
      price: tx.price.toFixed(),
    });
  }

  return {
    points,
    markers,
    avgCost: avgCost === null ? null : Number(avgCost),
  };
}
