// Lo que devuelve cada tool del asistente. Sin imports a propósito: el cliente lo usa para mostrar
// las fuentes debajo de cada respuesta (no puede arrastrar decimal.js ni `lib/engine`).
//
// Los datos llegan al modelo ya formateados como texto (`lib/portfolio/format.ts`): el modelo
// nunca recibe un número para operar, solo para repetirlo. `missing` dice explícitamente qué no se
// pudo calcular, así la respuesta puede decir "no tengo ese dato" en vez de inventarlo.

export interface ToolSource {
  /** La función que hizo el cálculo, p. ej. `computeTwr`. */
  fn: string;
  /** Para qué período o con qué precios, ya en texto: `1A (28/10/2025 – 28/10/2026)`. */
  detail: string;
}

export type ToolResult =
  | {
      ok: true;
      source: ToolSource;
      data: unknown;
      missing: string[];
      notes: string[];
    }
  | { ok: false; error: string };

/** Nombre visible de cada tool, para los chips de la UI. */
export const TOOL_LABELS: Record<string, string> = {
  get_positions: "Posiciones",
  get_gains: "Ganancias",
  get_performance: "Rendimiento",
  explain_move: "Qué movió la cartera",
  get_price_history: "Precio histórico",
  what_if: "¿Y si…?",
  get_risk: "Riesgo",
  simulate_trade: "Simulación",
  get_allocation: "Reparto",
  search_news: "Noticias",
  update_memory: "Memoria",
};

/** Qué está haciendo el asistente mientras corre cada tool, en palabras de la persona. */
export const TOOL_ACTIVITY: Record<string, string> = {
  get_positions: "Revisando tus posiciones",
  get_gains: "Calculando tus ganancias",
  get_performance: "Calculando el rendimiento",
  explain_move: "Viendo qué movió la cartera",
  get_price_history: "Mirando el precio histórico",
  what_if: "Simulando la compra",
  get_risk: "Midiendo el riesgo",
  simulate_trade: "Simulando la operación",
  get_allocation: "Viendo cómo está repartida tu cartera",
  search_news: "Buscando noticias",
  update_memory: "Guardando lo que me contaste",
};

/** Valida en el cliente que la salida de una tool tiene la forma esperada (viene de la red). */
export function sourceOf(output: unknown): ToolSource | null {
  if (typeof output !== "object" || output === null) return null;
  const record = output as Record<string, unknown>;
  if (record.ok !== true) return null;
  const source = record.source as Record<string, unknown> | undefined;
  if (typeof source?.fn !== "string" || typeof source.detail !== "string") {
    return null;
  }
  return { fn: source.fn, detail: source.detail };
}
