// Los rangos del gráfico de precio de la ficha. Sin imports a propósito: lo usa también el
// componente de cliente y no tiene que arrastrar el motor (decimal.js) al navegador.

export type ChartRange = "1w" | "1m" | "3m" | "1y";

/** Los rangos que se arman con barras del día (se piden a Yahoo al tocarlos). */
export type IntradayChartRange = "1w" | "1m";

/** Los rangos que se arman con los cierres diarios que ya lee el servidor (no se piden). */
export const DAILY_RANGES: ReadonlyArray<ChartRange> = ["3m", "1y"];

/** El rango con el que abre el gráfico. */
export const DEFAULT_RANGE: ChartRange = "3m";

export const RANGE_OPTIONS: ReadonlyArray<{ id: ChartRange; text: string }> = [
  { id: "1w", text: "1S" },
  { id: "1m", text: "1M" },
  { id: "3m", text: "3M" },
  { id: "1y", text: "1A" },
];

export const RANGE_NAME: Record<ChartRange, string> = {
  "1w": "1 semana",
  "1m": "1 mes",
  "3m": "3 meses",
  "1y": "1 año",
};
