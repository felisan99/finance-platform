import { D, type Dec } from "@/lib/engine/decimal";
import type { CorporateAction, DailyBar } from "./types";

// Yahoo reajusta hacia atrás los cierres de un split, pero no siempre todos juntos. Con el 3:1 de
// SOXX (ex 2026-11-05) devolvió, ya con el split informado, los cierres hasta el 30/10 divididos
// por 3 y los del 2, 3 y 4/11 todavía en la escala vieja (453–465 entre 157 y 132). Guardados así,
// el gráfico valuaba esos días al triple.
//
// La firma es inequívoca y se busca solo pegada al split: el día del split el precio cae (o sube)
// en la razón del split respecto del anterior, y unos días antes hay un salto en la razón inversa.
// Los cierres entre ese salto y el split quedaron sin ajustar: se dividen por la razón. Si falta
// alguna de las dos marcas, no se toca nada.

/** Cuántas ruedas antes del split se busca el salto. */
export const SPLIT_REPAIR_MAX_BARS = 10;
/** Splits más chicos que esto (p. ej. 5:4) se confunden con un movimiento real: no se reparan. */
export const SPLIT_REPAIR_MIN_RATIO = new D("1.5");

export interface SplitRepairResult {
  /** Ascendentes por fecha, como entraron. */
  bars: DailyBar[];
  /** Cierres divididos por la razón de un split. */
  repairedBars: number;
}

/**
 * Un salto `jump` (cierre / cierre anterior) se explica mejor por un split de razón `ratio` que
 * por un movimiento normal: está más cerca de `ratio` que de 1, en escala logarítmica.
 */
function looksLikeSplit(jump: Dec, ratio: Dec): boolean {
  const toSplit = jump.div(ratio).ln().abs();
  return toSplit.lt(jump.ln().abs()) && toSplit.lt(ratio.ln().abs().div(2));
}

const divide = (value: string, ratio: Dec, decimals: number): string =>
  new D(value).div(ratio).toDecimalPlaces(decimals, D.ROUND_HALF_UP).toFixed();

const decimalsOf = (value: string): number =>
  Math.max(value.split(".")[1]?.length ?? 0, 4);

export function repairPartialSplitAdjustment(
  bars: readonly DailyBar[],
  actions: readonly CorporateAction[],
): SplitRepairResult {
  const out = bars.map((bar) => ({ ...bar }));
  let repairedBars = 0;

  for (const action of actions) {
    if (action.type !== "SPLIT") continue;
    const ratio = new D(action.ratio);
    if (!ratio.gt(0)) continue;
    const big = ratio.gt(1) ? ratio : new D(1).div(ratio);
    if (big.lt(SPLIT_REPAIR_MIN_RATIO)) continue;

    const split = out.findIndex((bar) => bar.date >= action.exDate);
    if (split < 1) continue;

    // Día del split: el precio cambia en la razón inversa (450 → 132 con un 3:1).
    const atSplit = new D(out[split]!.close).div(out[split - 1]!.close);
    if (!looksLikeSplit(atSplit, new D(1).div(ratio))) continue;

    // Hacia atrás, el salto en la razón del split (157 → 453) donde empieza lo que quedó sin ajustar.
    let start = -1;
    for (let k = split - 1; k >= 1 && k >= split - SPLIT_REPAIR_MAX_BARS; k--) {
      const jump = new D(out[k]!.close).div(out[k - 1]!.close);
      if (looksLikeSplit(jump, ratio)) {
        start = k;
        break;
      }
    }
    if (start < 0) continue;

    for (let k = start; k < split; k++) {
      const bar = out[k]!;
      out[k] = {
        date: bar.date,
        close: divide(bar.close, ratio, decimalsOf(bar.close)),
        adjClose:
          bar.adjClose === null
            ? null
            : divide(bar.adjClose, ratio, decimalsOf(bar.adjClose)),
      };
      repairedBars++;
    }
  }

  return { bars: out, repairedBars };
}
