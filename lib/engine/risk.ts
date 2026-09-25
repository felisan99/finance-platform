import { ZERO, type Dec } from "./decimal";
import type { SeriesPoint } from "./series";

// Riesgo del portafolio: caída máxima, volatilidad y mejor/peor día. Puro.
//
// Todo sale del índice TWR encadenado de la serie diaria (`growth`), no del valor en dinero: el
// valor sube y baja con cada depósito y retiro, y eso no es riesgo. Los días sin base positiva
// (`growth = null`) no aportan retorno: el índice queda igual.

/** Con menos días de retornos la desviación estándar no dice nada. */
export const MIN_VOLATILITY_DAYS = 20;
/** Ruedas por año, para anualizar la volatilidad diaria. */
const TRADING_DAYS = 252;

const HUNDRED = ZERO.plus(100);

export interface DrawdownStat {
  /** Fracción negativa: −0.042 = 4,2 % por debajo del máximo. */
  depth: Dec;
  /** Día del máximo previo a la caída. */
  peakDate: string;
  /** Día del mínimo. */
  troughDate: string;
  /** Primer día en que el índice volvió al máximo previo; `null` si todavía no. */
  recoveredDate: string | null;
}

export interface DayReturn {
  date: string;
  /** Fracción (0.02 = +2 %). */
  value: Dec;
}

export interface DrawdownPoint {
  date: string;
  /** Distancia al máximo hasta ese día (≤ 0). */
  drawdown: Dec;
}

export interface RiskResult {
  /** Días con retorno que entraron al cálculo. */
  days: number;
  /** La peor caída de máximo a mínimo; `null` si el índice nunca bajó de su máximo. */
  maxDrawdown: DrawdownStat | null;
  /** Distancia al máximo al final del período (0 si está en máximos). */
  currentDrawdown: Dec;
  /**
   * Volatilidad anualizada (desvío muestral de los retornos diarios × √252), en fracción. `null`
   * con menos de `MIN_VOLATILITY_DAYS` días. Es una tasa para mostrar: se calcula con `number`
   * (como el XIRR), no es un monto.
   */
  volatility: number | null;
  bestDay: DayReturn | null;
  worstDay: DayReturn | null;
  /** El día base (0) y cada día de `(baseDate, endDate]`, para dibujar las caídas. */
  curve: DrawdownPoint[];
}

/**
 * Riesgo de `(baseDate, endDate]`. `null` si en el período no hubo ningún día con retorno.
 * `points` va en orden cronológico (así lo entrega `buildDailySeries`).
 */
export function computeRisk(
  points: readonly SeriesPoint[],
  baseDate: string,
  endDate: string,
): RiskResult | null {
  const returns: DayReturn[] = [];
  const curve: DrawdownPoint[] = [{ date: baseDate, drawdown: ZERO }];

  let index = HUNDRED;
  let peak = HUNDRED;
  let peakDate = baseDate;
  let current = ZERO;
  // La peor caída hasta ahora y el máximo (en valor) que hay que volver a alcanzar.
  let worst: (DrawdownStat & { peakIndex: Dec }) | null = null;

  for (const point of points) {
    if (point.date <= baseDate || point.date > endDate) continue;
    if (point.growth !== null) {
      index = index.mul(point.growth);
      returns.push({ date: point.date, value: point.growth.minus(1) });
    }
    if (
      worst !== null &&
      worst.recoveredDate === null &&
      index.gte(worst.peakIndex)
    ) {
      worst.recoveredDate = point.date;
    }
    // `gte`: si el índice se queda un tiempo en el máximo, la caída arranca desde el último día ahí.
    if (index.gte(peak)) {
      peak = index;
      peakDate = point.date;
    }
    current = index.div(peak).minus(1);
    curve.push({ date: point.date, drawdown: current });
    if (current.lt(worst?.depth ?? ZERO)) {
      worst = {
        depth: current,
        peakDate,
        troughDate: point.date,
        recoveredDate: null,
        peakIndex: peak,
      };
    }
  }
  if (returns.length === 0) return null;

  let best = returns[0] as DayReturn;
  let bad = returns[0] as DayReturn;
  for (const day of returns) {
    if (day.value.gt(best.value)) best = day;
    if (day.value.lt(bad.value)) bad = day;
  }

  return {
    days: returns.length,
    maxDrawdown:
      worst === null
        ? null
        : {
            depth: worst.depth,
            peakDate: worst.peakDate,
            troughDate: worst.troughDate,
            recoveredDate: worst.recoveredDate,
          },
    currentDrawdown: current,
    volatility: annualizedVolatility(returns),
    bestDay: best,
    worstDay: bad,
    curve,
  };
}

function annualizedVolatility(returns: readonly DayReturn[]): number | null {
  if (returns.length < MIN_VOLATILITY_DAYS) return null;
  const values = returns.map((r) => r.value.toNumber());
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
}
