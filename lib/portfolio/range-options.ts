// Los rangos del gráfico de precio de la ficha. Sin imports a propósito: lo usa también el
// componente de cliente y no tiene que arrastrar el motor (decimal.js) al navegador.

export type ChartRange = "1w" | "1m" | "1y";

export const RANGE_OPTIONS: ReadonlyArray<{ id: ChartRange; text: string }> = [
  { id: "1w", text: "1S" },
  { id: "1m", text: "1M" },
  { id: "1y", text: "1A" },
];

export const RANGE_NAME: Record<ChartRange, string> = {
  "1w": "1 semana",
  "1m": "1 mes",
  "1y": "1 año",
};
