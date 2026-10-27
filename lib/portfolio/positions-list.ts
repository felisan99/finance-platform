import type { Dec, ValuedPosition } from "@/lib/engine";

/** Los órdenes que se ofrecen, en el orden del menú. */
export const POSITION_SORTS = ["value", "pnlPct", "dayPct", "symbol"] as const;
export type PositionSort = (typeof POSITION_SORTS)[number];

export const POSITION_SORT_LABELS: Record<PositionSort, string> = {
  value: "Valor",
  pnlPct: "Ganancia",
  dayPct: "Hoy",
  symbol: "A–Z",
};

/** Órdenes que ya no se ofrecen, para que los enlaces viejos sigan andando. */
const LEGACY_SORTS: Readonly<Record<string, PositionSort>> = {
  pnl: "pnlPct",
};

/** `?orden=` de la URL → orden válido; lo desconocido (o `__proto__`) vuelve al valor por defecto. */
export function parsePositionSort(
  param: string | string[] | undefined,
): PositionSort {
  const value = Array.isArray(param) ? param[0] : param;
  if (value !== undefined && Object.hasOwn(LEGACY_SORTS, value)) {
    return LEGACY_SORTS[value]!;
  }
  return POSITION_SORTS.find((sort) => sort === value) ?? "value";
}

/** Mayor primero; lo que no tiene valor (posición sin precio) queda al final. */
function desc(
  a: ValuedPosition,
  b: ValuedPosition,
  pick: (p: ValuedPosition) => Dec | null,
): number {
  const x = pick(a);
  const y = pick(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y.cmp(x);
}

const bySymbol = (a: ValuedPosition, b: ValuedPosition) =>
  a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;

/** Ordena las posiciones abiertas. Los empates se resuelven por símbolo, así el orden es estable. */
export function sortPositions(
  positions: readonly ValuedPosition[],
  sort: PositionSort,
): ValuedPosition[] {
  const list = [...positions];
  switch (sort) {
    case "value":
      // Las que no tienen precio van al final, de mayor a menor costo.
      return list.sort(
        (a, b) =>
          desc(a, b, (p) => p.marketValue) ||
          (a.marketValue === null && b.marketValue === null
            ? b.costBasis.cmp(a.costBasis)
            : 0) ||
          bySymbol(a, b),
      );
    case "dayPct":
      return list.sort(
        (a, b) => desc(a, b, (p) => p.dayChangePct) || bySymbol(a, b),
      );
    case "pnlPct":
      return list.sort(
        (a, b) => desc(a, b, (p) => p.unrealizedPct) || bySymbol(a, b),
      );
    case "symbol":
      return list.sort(bySymbol);
  }
}

/** Abiertas y cerradas por separado; las cerradas, de mayor a menor ganancia realizada. */
export function splitPositions(positions: readonly ValuedPosition[]): {
  open: ValuedPosition[];
  closed: ValuedPosition[];
} {
  return {
    open: positions.filter((p) => p.isOpen),
    closed: positions
      .filter((p) => !p.isOpen)
      .sort((a, b) => b.realizedPnl.cmp(a.realizedPnl) || bySymbol(a, b)),
  };
}
