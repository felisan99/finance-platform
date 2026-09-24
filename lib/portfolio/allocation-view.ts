import {
  ZERO,
  computeAllocation,
  type Allocation,
  type AllocationSlice,
  type Dec,
  type ValuedPortfolio,
} from "@/lib/engine";
import { formatMoney, formatPercent } from "./format";

// Composición del portafolio para la pantalla (spec §6.6): el cálculo es de `lib/engine/allocation.ts`;
// acá se agrupa la cola en "Otros", se les pone nombre en español y color, y se formatea.

export type AllocationDimension = "position" | "type";

export interface AllocationSliceView {
  id: string;
  label: string;
  /** Qué símbolos hay adentro, cuando el nombre solo no lo dice (por tipo y "Otros"). */
  detail: string | null;
  /** Variable CSS de `app/globals.css`. */
  color: string;
  amount: string;
  percent: string;
  /** Fracción para dibujar el ángulo; es solo de presentación, no se usa para calcular nada. */
  share: number;
}

export interface AllocationView {
  dimension: AllocationDimension;
  /** El texto del botón que elige esta vista. */
  title: string;
  slices: AllocationSliceView[];
}

export interface AllocationViews {
  total: string;
  views: AllocationView[];
}

/** Colores distintos que tiene la paleta (`--alloc-1` … `--alloc-6`). */
export const PALETTE_SIZE = 6;
/** Más porciones con nombre que esto no se distinguen en un gráfico chico: la cola va a "Otros". */
export const MAX_NAMED_SLICES = PALETTE_SIZE;

const TYPE_LABELS: Record<string, string> = {
  STOCK: "Acciones",
  ETF: "ETF",
};

const CASH_COLOR = "var(--alloc-cash)";
const OTHER_COLOR = "var(--alloc-other)";

/** Un tipo que no conocemos se muestra tal cual, capitalizado; nada de romper por un valor nuevo. */
function typeLabel(type: string): string {
  const known = TYPE_LABELS[type];
  if (known) return known;
  const lower = type.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function labelOf(slice: AllocationSlice, dimension: AllocationDimension) {
  if (slice.kind === "cash") return "Efectivo";
  if (slice.kind === "unclassified") return "Sin clasificar";
  return dimension === "type" ? typeLabel(slice.key) : slice.key;
}

function toView(
  amounts: { value: Dec; weight: Dec },
  base: Pick<AllocationSliceView, "id" | "label" | "detail" | "color">,
): AllocationSliceView {
  return {
    ...base,
    amount: formatMoney(amounts.value),
    percent: formatPercent(amounts.weight),
    share: amounts.weight.toNumber(),
  };
}

/**
 * Las porciones tal como se dibujan. Las de mayor valor conservan su nombre y reciben los colores
 * de la paleta en orden; si sobran más que `MAX_NAMED_SLICES`, la cola se junta en "Otros". El
 * efectivo tiene siempre su propia porción y su gris.
 */
export function buildAllocationSlices(
  allocation: Allocation,
  dimension: AllocationDimension,
): AllocationSliceView[] {
  const named = allocation.slices.filter((s) => s.kind !== "cash");
  const collapsed =
    named.length > MAX_NAMED_SLICES ? named.slice(MAX_NAMED_SLICES - 1) : [];
  const collapsedSet = new Set(collapsed);

  const views: AllocationSliceView[] = [];
  let colorIndex = 0;
  for (const slice of allocation.slices) {
    if (collapsedSet.has(slice)) continue;
    const id = `${slice.kind}:${slice.key}`;
    const label = labelOf(slice, dimension);
    if (slice.kind === "cash") {
      views.push(toView(slice, { id, label, detail: null, color: CASH_COLOR }));
      continue;
    }
    colorIndex += 1;
    views.push(
      toView(slice, {
        id,
        label,
        detail: dimension === "type" ? slice.symbols.join(", ") : null,
        color: `var(--alloc-${colorIndex})`,
      }),
    );
  }

  if (collapsed.length > 0) {
    const value = collapsed.reduce((acc, s) => acc.plus(s.value), ZERO);
    const symbols = collapsed.flatMap((s) => s.symbols).sort();
    views.push(
      toView(
        { value, weight: value.div(allocation.total) },
        {
          id: "other",
          label: "Otros",
          detail: symbols.join(", "),
          color: OTHER_COLOR,
        },
      ),
    );
  }
  return views;
}

/**
 * Las vistas de la composición: por posición y por tipo (el sector queda afuera: los ETF no lo
 * tienen y sería casi todo "sin clasificar"). `null` si no hay nada que dibujar.
 */
export function buildAllocationViews(
  valued: ValuedPortfolio,
  typeBySymbol: (symbol: string) => string | null,
): AllocationViews | null {
  const byPosition = computeAllocation(valued, (symbol) => symbol);
  if (byPosition.slices.length === 0) return null;
  const byType = computeAllocation(valued, (symbol) => {
    const type = typeBySymbol(symbol)?.trim().toUpperCase();
    return type ? type : null;
  });
  return {
    total: formatMoney(byPosition.total),
    views: [
      {
        dimension: "position",
        title: "Posiciones",
        slices: buildAllocationSlices(byPosition, "position"),
      },
      {
        dimension: "type",
        title: "Tipo",
        slices: buildAllocationSlices(byType, "type"),
      },
    ],
  };
}
