import { daysBetween } from "./dates";
import { d, ZERO, type Dec } from "./decimal";
import type { SeriesPoint } from "./series";

// Rendimientos (spec §6.5): TWR, su anualización y XIRR. Puro.

const ONE = ZERO.plus(1);
const YEAR_DAYS = 365;

export interface TwrResult {
  /** Fracción (0.1 = +10 %); `null` si en el período no hubo ningún día con base positiva. */
  twr: Dec | null;
  /** Días con retorno que entraron en el encadenamiento. */
  days: number;
}

/**
 * TWR del período `(baseDate, endDate]`: `Π (1 + r_t) − 1` con el encadenamiento diario de la
 * serie. El día base no entra: su retorno pertenece al período anterior. Los días sin base
 * positiva (`growth = null`) no aportan retorno.
 */
export function computeTwr(
  points: readonly SeriesPoint[],
  baseDate: string,
  endDate: string,
): TwrResult {
  let product = ONE;
  let days = 0;
  for (const point of points) {
    if (point.date <= baseDate || point.date > endDate) continue;
    if (point.growth === null) continue;
    product = product.mul(point.growth);
    days++;
  }
  return { twr: days === 0 ? null : product.minus(1), days };
}

/**
 * Anualiza un retorno acumulado, solo si el período dura más de un año (spec §6.5): en períodos
 * cortos anualizar exagera. `null` si no corresponde.
 */
export function annualizeTwr(
  twr: Dec | null,
  calendarDays: number,
): Dec | null {
  if (twr === null || calendarDays <= YEAR_DAYS) return null;
  const growth = ONE.plus(twr);
  if (!growth.gt(0)) return ZERO.minus(1);
  return growth.pow(ZERO.plus(YEAR_DAYS).div(calendarDays)).minus(1);
}

export interface DatedFlow {
  /** YYYY-MM-DD */
  date: string;
  /** Desde el punto de vista del inversor: lo que pone es negativo, lo que recibe es positivo. */
  amount: Dec;
}

const RATE_FLOOR = -0.999999;
const MAX_ITERATIONS = 200;

/**
 * XIRR: la tasa anual `r` que anula `Σ monto_i / (1 + r)^((fecha_i − fecha_0) / 365)`. Newton-Raphson
 * y, si no converge o se sale del dominio, bisección. `null` si no hay al menos una entrada y una
 * salida, si todo ocurre el mismo día o si no hay raíz.
 *
 * Se calcula con `number`: el resultado es una tasa para mostrar (no un monto que se guarde), la
 * potencia fraccionaria con decimal es lenta y doble precisión sobra (se converge a 1e-12).
 */
export function computeXirr(flows: readonly DatedFlow[]): Dec | null {
  const usable = flows.filter((flow) => !flow.amount.isZero());
  if (
    !usable.some((flow) => flow.amount.lt(0)) ||
    !usable.some((flow) => flow.amount.gt(0))
  ) {
    return null;
  }
  const origin = usable.reduce(
    (min, flow) => (flow.date < min ? flow.date : min),
    (usable[0] as DatedFlow).date,
  );
  const terms = usable.map((flow) => ({
    amount: flow.amount.toNumber(),
    years: daysBetween(origin, flow.date) / YEAR_DAYS,
  }));
  if (terms.every((term) => term.years === 0)) return null;

  const npv = (rate: number) =>
    terms.reduce(
      (sum, term) => sum + term.amount * Math.pow(1 + rate, -term.years),
      0,
    );
  const slope = (rate: number) =>
    terms.reduce(
      (sum, term) =>
        sum - term.years * term.amount * Math.pow(1 + rate, -term.years - 1),
      0,
    );

  const toResult = (rate: number): Dec => d(rate.toPrecision(15));

  // Newton-Raphson desde 10 %.
  let rate = 0.1;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const value = npv(rate);
    if (Math.abs(value) < 1e-10) return toResult(rate);
    const derivative = slope(rate);
    if (!Number.isFinite(derivative) || derivative === 0) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= RATE_FLOOR) break;
    if (Math.abs(next - rate) < 1e-13) return toResult(next);
    rate = next;
  }

  // Respaldo: bisección sobre un intervalo con cambio de signo.
  let low = RATE_FLOOR;
  let high = 1;
  const lowValue = npv(low);
  if (!Number.isFinite(lowValue)) return null;
  while (Math.sign(npv(high)) === Math.sign(lowValue) && high < 1e9) {
    high *= 4;
  }
  if (Math.sign(npv(high)) === Math.sign(lowValue)) return null;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);
    if (midValue === 0 || high - low < 1e-13) return toResult(mid);
    if (Math.sign(midValue) === Math.sign(lowValue)) low = mid;
    else high = mid;
  }
  return toResult((low + high) / 2);
}
