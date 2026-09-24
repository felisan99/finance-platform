import { ZERO, type Dec } from "./decimal";
import type { ValuedPortfolio } from "./valuation";

// Composición del portafolio (spec §6.6): cuánto del valor total hay en cada grupo, con el efectivo
// como categoría propia. Puro: el criterio de agrupación llega por parámetro (por posición, por tipo,
// por sector…) y nada se redondea.

export type AllocationKind = "group" | "unclassified" | "cash";

export interface AllocationSlice {
  kind: AllocationKind;
  /** El grupo que devolvió `classify` (un símbolo, un tipo…); `""` en efectivo y sin clasificar. */
  key: string;
  value: Dec;
  /** Fracción del total dibujado; todas las porciones suman 1. */
  weight: Dec;
  /** Símbolos que aportan a la porción, en orden alfabético (vacío en el efectivo). */
  symbols: string[];
}

export interface Allocation {
  /** De mayor a menor valor; los empates se desempatan por tipo y nombre para que el orden sea estable. */
  slices: AllocationSlice[];
  /** Σ de las porciones. Coincide con `valued.totalValue` salvo que haya efectivo negativo. */
  total: Dec;
  /** Posiciones abiertas sin precio: no entran en la composición. */
  missingPrices: string[];
}

interface Bucket {
  kind: AllocationKind;
  key: string;
  value: Dec;
  symbols: string[];
}

/**
 * Reparte el valor de mercado de las posiciones abiertas (con precio) y el efectivo en porciones.
 * `classify` devuelve el grupo de un símbolo, o `null` si no se sabe (queda como "sin clasificar").
 *
 * Una porción con valor ≤ 0 no se dibuja: un efectivo negativo (falta cargar un depósito) no cabe
 * en un gráfico de torta, y la pantalla ya lo avisa por otro lado.
 */
export function computeAllocation(
  valued: ValuedPortfolio,
  classify: (symbol: string) => string | null,
): Allocation {
  const buckets = new Map<string, Bucket>();
  const add = (
    kind: AllocationKind,
    key: string,
    value: Dec,
    symbol?: string,
  ) => {
    const id = `${kind}:${key}`;
    const bucket = buckets.get(id) ?? { kind, key, value: ZERO, symbols: [] };
    bucket.value = bucket.value.plus(value);
    if (symbol !== undefined) bucket.symbols.push(symbol);
    buckets.set(id, bucket);
  };

  for (const position of valued.positions) {
    if (!position.isOpen || position.marketValue === null) continue;
    const group = classify(position.symbol);
    if (group === null) {
      add("unclassified", "", position.marketValue, position.symbol);
    } else {
      add("group", group, position.marketValue, position.symbol);
    }
  }
  add("cash", "", valued.cash);

  const drawn = [...buckets.values()].filter((bucket) => bucket.value.gt(0));
  const total = drawn.reduce((acc, bucket) => acc.plus(bucket.value), ZERO);

  const slices: AllocationSlice[] = drawn
    .map((bucket) => ({
      kind: bucket.kind,
      key: bucket.key,
      value: bucket.value,
      weight: bucket.value.div(total),
      symbols: [...bucket.symbols].sort(compareText),
    }))
    .sort(
      (a, b) =>
        b.value.comparedTo(a.value) ||
        compareText(`${a.kind}:${a.key}`, `${b.kind}:${b.key}`),
    );

  return {
    slices,
    total,
    missingPrices: valued.missingPrices,
  };
}

// Sin `localeCompare`: el orden no puede depender del idioma del servidor.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
