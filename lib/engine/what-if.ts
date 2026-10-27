import { addDays, addMonths, isWeekday, marketDay } from "./dates";
import { D, ZERO, type Dec } from "./decimal";
import {
  MIN_VOLATILITY_DAYS,
  TRADING_DAYS,
  annualizedVolatilityOf,
  type DrawdownStat,
} from "./risk";
import { sortCloses } from "./series";
import type { Transaction } from "./types";
import type { DailyClose, ValuedPortfolio } from "./valuation";

// «Antes de comprar» (ficha de un activo): qué le haría una compra a la cartera de hoy y cómo le
// habría ido a un aporte mensual en ese activo. Puro: "hoy", los cierres y los montos llegan por
// parámetro.
//
// La cartera se mira con sus pesos de hoy aplicados a los retornos del último año (la convención de
// las herramientas de riesgo: "tu cartera de hoy, quieta"). Los montos van con `D`; los retornos, la
// volatilidad y la correlación son tasas para mostrar y van con `number`, como el XIRR.

/** Con menos retornos en común la volatilidad y la correlación no dicen nada. */
export const MIN_SHARED_DAYS = 60;
/** Una historia que arranca hasta estos días después del inicio pedido no recorta la ventana. */
const START_TOLERANCE_DAYS = 7;

const HALF = new D("0.5");
/** Decimales de `valor / aportado − 1`: muy por debajo de lo que se muestra y por encima del ruido. */
const RATIO_DECIMALS = 12;

// --- Aporte típico ------------------------------------------------------------------------------

/**
 * Lo que la persona deposita en un mes típico: la mediana de la suma de depósitos de cada mes con
 * depósitos entre los últimos 12 meses (el de `today` incluido). `null` si no depositó en ese lapso.
 */
export function typicalMonthlyDeposit(
  transactions: readonly Transaction[],
  today: string,
): Dec | null {
  const after = addMonths(today, -12).slice(0, 7);
  const until = today.slice(0, 7);
  const byMonth = new Map<string, Dec>();
  for (const tx of transactions) {
    if (tx.type !== "DEPOSIT" || !tx.amount.gt(0)) continue;
    const month = marketDay(tx.executedAt).slice(0, 7);
    if (month <= after || month > until) continue;
    byMonth.set(month, (byMonth.get(month) ?? ZERO).plus(tx.amount));
  }
  const sums = [...byMonth.values()].sort((a, b) => a.comparedTo(b));
  if (sums.length === 0) return null;
  const middle = sums.length >> 1;
  return sums.length % 2 === 1
    ? (sums[middle] as Dec)
    : (sums[middle - 1] as Dec).plus(sums[middle] as Dec).mul(HALF);
}

// --- Composición antes y después -------------------------------------------------------------------

export interface Composition {
  /** Posiciones con precio + efectivo (el efectivo negativo cuenta como 0, como en la composición). */
  total: Dec;
  /** Peso de cada posición abierta con precio sobre `total`. */
  weights: Map<string, Dec>;
  /** Peso del grupo del candidato (sector, "ETF"…); `null` si el candidato no tiene grupo. */
  groupWeight: Dec | null;
  /** Σ de los pesos de las 3 posiciones más grandes. */
  top3: Dec;
  /** Posiciones abiertas con precio. */
  positions: number;
}

export interface AdditionResult {
  /** `null` si hoy no hay nada valuado (sin posiciones con precio ni efectivo). */
  before: Composition | null;
  after: Composition;
  /** El grupo del candidato según `groupOf`. */
  group: string | null;
}

/**
 * Compra de `amount` dólares de `candidate` con plata nueva (un depósito que se invierte entero): el
 * efectivo no cambia y el total crece en `amount`. Las posiciones sin precio no entran (la pantalla
 * ya avisa que el total es parcial). `amount` tiene que ser positivo.
 */
export function simulateAddition(
  valued: ValuedPortfolio,
  candidate: string,
  amount: Dec,
  groupOf: (symbol: string) => string | null,
): AdditionResult {
  if (!amount.gt(0)) throw new RangeError("el monto tiene que ser positivo");

  const values = new Map<string, Dec>();
  for (const position of valued.positions) {
    if (!position.isOpen || position.marketValue === null) continue;
    values.set(position.symbol, position.marketValue);
  }
  const cash = valued.cash.gt(0) ? valued.cash : ZERO;
  const group = groupOf(candidate);

  const afterValues = new Map(values);
  afterValues.set(candidate, (values.get(candidate) ?? ZERO).plus(amount));

  const before = composition(values, cash, group, groupOf);
  return {
    before: before.total.gt(0) ? before : null,
    after: composition(afterValues, cash, group, groupOf),
    group,
  };
}

function composition(
  values: ReadonlyMap<string, Dec>,
  cash: Dec,
  group: string | null,
  groupOf: (symbol: string) => string | null,
): Composition {
  let total = cash;
  for (const value of values.values()) total = total.plus(value);

  const weights = new Map<string, Dec>();
  if (total.gt(0)) {
    for (const [symbol, value] of values) {
      weights.set(symbol, value.div(total));
    }
  }
  let groupWeight: Dec | null = null;
  if (group !== null) {
    groupWeight = ZERO;
    for (const [symbol, weight] of weights) {
      if (groupOf(symbol) === group) groupWeight = groupWeight.plus(weight);
    }
  }
  const top3 = [...weights.values()]
    .sort((a, b) => b.comparedTo(a))
    .slice(0, 3)
    .reduce((acc, weight) => acc.plus(weight), ZERO);

  return { total, weights, groupWeight, top3, positions: values.size };
}

// --- Retornos diarios alineados ------------------------------------------------------------------

export interface AlignedReturns {
  /** Día de cada retorno (el de llegada), en orden. */
  dates: string[];
  /** Retornos diarios (fracción) de cada símbolo con historia, alineados con `dates`. */
  bySymbol: Map<string, number[]>;
  /** El `anchor`, si su historia arranca tarde y por eso la ventana empieza después de lo pedido. */
  limitedBy: { symbol: string; since: string } | null;
  /** Otros símbolos con historia que arranca tarde: no entran (recortarían la ventana de todos). */
  shortHistory: Array<{ symbol: string; since: string }>;
  /** Símbolos sin ningún cierre en la ventana: no entran. */
  missing: string[];
}

/**
 * Retornos diarios de `[from, to]` en los días que tienen cierre todos los símbolos que entran: si a
 * uno le falta un día, el retorno siguiente abarca los dos. Los cierres no positivos se descartan
 * (serían un dato roto).
 *
 * Un símbolo cuya historia arranca más de una semana después de `from` recortaría la ventana de
 * todos: queda afuera (`shortHistory`), salvo el `anchor` (el candidato), que sí la recorta
 * (`limitedBy`). Así una salida a bolsa reciente en la cartera no deja sin datos a los demás.
 */
export function alignReturns(
  closes: ReadonlyMap<string, readonly DailyClose[]>,
  from: string,
  to: string,
  anchor?: string,
): AlignedReturns {
  const byDate = new Map<string, Map<string, Dec>>();
  const missing: string[] = [];
  const shortHistory: Array<{ symbol: string; since: string }> = [];
  let limitedBy: { symbol: string; since: string } | null = null;

  for (const [symbol, list] of closes) {
    const inWindow = new Map<string, Dec>();
    for (const close of list) {
      if (close.date < from || close.date > to || !close.close.gt(0)) continue;
      inWindow.set(close.date, close.close);
    }
    if (inWindow.size === 0) {
      missing.push(symbol);
      continue;
    }
    const since = [...inWindow.keys()].reduce((a, b) => (b < a ? b : a));
    if (since > addDays(from, START_TOLERANCE_DAYS)) {
      if (symbol !== anchor) {
        shortHistory.push({ symbol, since });
        continue;
      }
      limitedBy = { symbol, since };
    }
    byDate.set(symbol, inWindow);
  }

  const symbols = [...byDate.keys()];
  const common =
    symbols.length === 0
      ? []
      : [...(byDate.get(symbols[0] as string) as Map<string, Dec>).keys()]
          // Solo días hábiles: la cripto cotiza también el fin de semana, y así un par de monedas
          // mira las mismas ruedas que una acción (el lunes absorbe el fin de semana) y la
          // volatilidad se anualiza igual, con 252.
          .filter(
            (date) =>
              isWeekday(date) &&
              symbols.every((symbol) => byDate.get(symbol)?.has(date)),
          )
          .sort();

  const bySymbol = new Map<string, number[]>();
  for (const symbol of symbols) {
    const series = byDate.get(symbol) as Map<string, Dec>;
    const returns: number[] = [];
    for (let k = 1; k < common.length; k++) {
      const previous = series.get(common[k - 1] as string) as Dec;
      const current = series.get(common[k] as string) as Dec;
      returns.push(current.div(previous).minus(1).toNumber());
    }
    bySymbol.set(symbol, returns);
  }

  return {
    dates: common.slice(1),
    bySymbol,
    limitedBy,
    shortHistory: shortHistory.sort((a, b) =>
      a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0,
    ),
    missing: missing.sort(),
  };
}

/** Correlación de Pearson. `null` con menos de `MIN_SHARED_DAYS` pares o si una serie no varía. */
export function correlation(
  a: readonly number[],
  b: readonly number[],
): number | null {
  const n = Math.min(a.length, b.length);
  if (n < MIN_SHARED_DAYS) return null;
  // Una serie constante no tiene correlación. Se mira antes de restar la media: en floats, restarla
  // deja una varianza de 1e-35 en vez de 0.
  if (isConstant(a, n) || isConstant(b, n)) return null;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i] as number;
    meanB += b[i] as number;
  }
  meanA /= n;
  meanB /= n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = (a[i] as number) - meanA;
    const db = (b[i] as number) - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  // El redondeo puede dejar el resultado apenas fuera de [−1, 1].
  return Math.max(-1, Math.min(1, cov / Math.sqrt(varA * varB)));
}

function isConstant(values: readonly number[], n: number): boolean {
  for (let i = 1; i < n; i++) {
    if (values[i] !== values[0]) return false;
  }
  return true;
}

/** Retorno diario de una cartera con pesos fijos (fracción de su total; el efectivo rinde 0). */
function weightedReturns(
  aligned: AlignedReturns,
  weights: ReadonlyMap<string, Dec>,
): number[] | null {
  const parts: Array<{ weight: number; returns: number[] }> = [];
  for (const [symbol, weight] of weights) {
    const returns = aligned.bySymbol.get(symbol);
    if (returns && weight.gt(0)) {
      parts.push({ weight: weight.toNumber(), returns });
    }
  }
  if (parts.length === 0) return null;
  return aligned.dates.map((_, k) =>
    parts.reduce((sum, part) => sum + part.weight * (part.returns[k] ?? 0), 0),
  );
}

export interface FitResult {
  /** Retornos en común que entraron al cálculo. */
  days: number;
  /** Correlación del candidato con el resto de la cartera (sin el candidato). */
  correlation: number | null;
  /** La posición (distinta del candidato) que más se le parece. */
  closest: { symbol: string; correlation: number } | null;
  /** Volatilidad anualizada de la cartera de hoy y de la de después de la compra. */
  volatilityBefore: number | null;
  volatilityAfter: number | null;
}

/**
 * Cuánto se parece el candidato a lo que ya hay y cómo cambia la volatilidad de la cartera. Los
 * pesos son los de `simulateAddition` (fracción del total, con el efectivo adentro). Todo `null`
 * con menos de `MIN_SHARED_DAYS` retornos en común.
 */
export function analyzeFit(
  aligned: AlignedReturns,
  candidate: string,
  before: ReadonlyMap<string, Dec> | null,
  after: ReadonlyMap<string, Dec>,
): FitResult {
  const days = aligned.dates.length;
  const empty: FitResult = {
    days,
    correlation: null,
    closest: null,
    volatilityBefore: null,
    volatilityAfter: null,
  };
  if (days < MIN_SHARED_DAYS) return empty;

  const own = aligned.bySymbol.get(candidate) ?? null;
  const rest = new Map(
    [...(before ?? new Map<string, Dec>())].filter(([s]) => s !== candidate),
  );
  const restReturns = rest.size > 0 ? weightedReturns(aligned, rest) : null;

  let closest: FitResult["closest"] = null;
  if (own) {
    for (const symbol of [...rest.keys()].sort()) {
      const returns = aligned.bySymbol.get(symbol);
      const value = returns ? correlation(own, returns) : null;
      if (value !== null && (closest === null || value > closest.correlation)) {
        closest = { symbol, correlation: value };
      }
    }
  }

  const beforeReturns = before ? weightedReturns(aligned, before) : null;
  const afterReturns = weightedReturns(aligned, after);
  return {
    days,
    correlation: own && restReturns ? correlation(own, restReturns) : null,
    closest,
    volatilityBefore: beforeReturns
      ? annualizedVolatilityOf(beforeReturns)
      : null,
    volatilityAfter: afterReturns ? annualizedVolatilityOf(afterReturns) : null,
  };
}

// --- Volatilidad para cualquier monto ------------------------------------------------------------

/**
 * Varianzas y covarianza anualizadas (× 252, muestrales) de los retornos diarios de la cartera de hoy
 * y del candidato. La persona puede elegir cualquier monto en la pantalla y no se recalcula nada en
 * el servidor: comprar `x` veces el total de hoy deja el retorno diario en `(cartera + x·candidato)
 * / (1 + x)`, así que la volatilidad de después es
 * `√(portfolio + 2·x·covariance + x²·candidate) / (1 + x)` (y la de antes, `√portfolio`): la misma
 * que da `analyzeFit` con los pesos de `simulateAddition`.
 */
export interface VolatilityModel {
  portfolio: number;
  covariance: number;
  /** 0 si el candidato no tiene retornos (no suma variación: solo diluye). */
  candidate: number;
}

/** Covarianza muestral de dos series alineadas (`a` consigo misma: la varianza). */
function sampleCovariance(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i] as number;
    meanB += b[i] as number;
  }
  meanA /= n;
  meanB /= n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += ((a[i] as number) - meanA) * ((b[i] as number) - meanB);
  }
  return sum / (n - 1);
}

/**
 * El modelo de la volatilidad de la cartera después de comprar `candidate` con cualquier monto.
 * `before` son los pesos de hoy de `simulateAddition`. `null` cuando `analyzeFit` no daría la
 * volatilidad de antes: sin cartera, con menos de `MIN_SHARED_DAYS` retornos en común o si ninguna
 * posición tiene retornos.
 */
export function volatilityModel(
  aligned: AlignedReturns,
  candidate: string,
  before: ReadonlyMap<string, Dec> | null,
): VolatilityModel | null {
  if (before === null || aligned.dates.length < MIN_SHARED_DAYS) return null;
  const portfolio = weightedReturns(aligned, before);
  if (portfolio === null || portfolio.length < MIN_VOLATILITY_DAYS) return null;
  const own = aligned.bySymbol.get(candidate) ?? null;
  return {
    portfolio: sampleCovariance(portfolio, portfolio) * TRADING_DAYS,
    covariance: own ? sampleCovariance(portfolio, own) * TRADING_DAYS : 0,
    candidate: own ? sampleCovariance(own, own) * TRADING_DAYS : 0,
  };
}

// --- Aporte mensual ----------------------------------------------------------------------------

export interface PlanPoint {
  date: string;
  /** Aportado hasta ese día (incluido el aporte del día). */
  invested: Dec;
  /** Valor de lo comprado al cierre de ese día. */
  value: Dec;
}

export interface Underwater {
  /** El día en que lo invertido estuvo más por debajo de lo aportado. */
  date: string;
  /** `valor / aportado − 1` ese día (negativo). */
  depth: Dec;
  /** Primer día posterior en que el valor volvió a lo aportado; `null` si todavía no. */
  recoveredDate: string | null;
}

export interface MonthlyPlanResult {
  /** Día del primer aporte y último día de la serie. */
  start: string;
  end: string;
  contributions: number;
  invested: Dec;
  value: Dec;
  points: PlanPoint[];
  /** El peor momento; `null` si el valor nunca bajó de lo aportado. */
  worst: Underwater | null;
}

/**
 * `amount` dólares el primer día con cierre de cada mes desde `from` hasta `to` (el primero, el
 * primer cierre desde `from`), comprando fracciones de unidad al cierre. Con cierres ajustados por
 * dividendos (`adj_close`) el valor incluye los dividendos reinvertidos. `null` si no hay ningún
 * cierre en el rango.
 */
export function simulateMonthlyPlan(
  closes: readonly DailyClose[],
  amount: Dec,
  from: string,
  to: string,
): MonthlyPlanResult | null {
  if (!amount.gt(0)) throw new RangeError("el monto tiene que ser positivo");

  let month: string | null = null;
  let units = ZERO;
  let invested = ZERO;
  let contributions = 0;
  const points: PlanPoint[] = [];
  let worst: Underwater | null = null;

  for (const close of sortCloses(closes)) {
    if (close.date < from || close.date > to || !close.close.gt(0)) continue;
    const key = close.date.slice(0, 7);
    if (key !== month) {
      month = key;
      units = units.plus(amount.div(close.close));
      invested = invested.plus(amount);
      contributions += 1;
    }
    const value = units.mul(close.close);
    points.push({ date: close.date, invested, value });

    // Redondeado: `monto / precio × precio` puede dar 99,999…9 (40 dígitos) y no es una pérdida.
    const ratio = value.div(invested).minus(1).toDecimalPlaces(RATIO_DECIMALS);
    if (worst !== null && worst.recoveredDate === null && ratio.gte(0)) {
      worst.recoveredDate = close.date;
    }
    if (ratio.lt(worst?.depth ?? ZERO)) {
      worst = { date: close.date, depth: ratio, recoveredDate: null };
    }
  }

  const last = points.at(-1);
  if (!last) return null;
  return {
    start: (points[0] as PlanPoint).date,
    end: last.date,
    contributions,
    invested: last.invested,
    value: last.value,
    points,
    worst,
  };
}

/**
 * La mayor caída del precio de máximo a mínimo en `[from, to]`, con cuándo se recuperó. `null` si
 * en el rango el precio nunca bajó de un máximo previo.
 */
export function priceDrawdown(
  closes: readonly DailyClose[],
  from: string,
  to: string,
): DrawdownStat | null {
  let peak: DailyClose | null = null;
  let worst: (DrawdownStat & { peakClose: Dec }) | null = null;

  for (const close of sortCloses(closes)) {
    if (close.date < from || close.date > to || !close.close.gt(0)) continue;
    if (
      worst !== null &&
      worst.recoveredDate === null &&
      close.close.gte(worst.peakClose)
    ) {
      worst.recoveredDate = close.date;
    }
    if (peak === null || close.close.gte(peak.close)) {
      peak = close;
      continue;
    }
    const depth = close.close.div(peak.close).minus(1);
    if (depth.lt(worst?.depth ?? ZERO)) {
      worst = {
        depth,
        peakDate: peak.date,
        troughDate: close.date,
        recoveredDate: null,
        peakClose: peak.close,
      };
    }
  }
  if (worst === null) return null;
  return {
    depth: worst.depth,
    peakDate: worst.peakDate,
    troughDate: worst.troughDate,
    recoveredDate: worst.recoveredDate,
  };
}
