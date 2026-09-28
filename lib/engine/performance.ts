import {
  addDays,
  addMonths,
  daysBetween,
  onOrBeforeWeekday,
  yearOf,
} from "./dates";
import { ZERO, type Dec } from "./decimal";
import {
  annualizeTwr,
  computeTwr,
  computeXirr,
  type DatedFlow,
} from "./returns";
import {
  buildDailySeries,
  closeOnOrBefore,
  sortCloses,
  type DailySeries,
  type SeriesInput,
} from "./series";
import type { DailyClose } from "./valuation";

// Rendimiento del portafolio por período (spec §6.5): TWR, XIRR y retorno del benchmark. Puro.

export const PERIOD_IDS = ["1S", "1M", "3M", "YTD", "1A", "MAX"] as const;
export type PeriodId = (typeof PERIOD_IDS)[number];

/**
 * XIRR es una tasa anual: en un período de pocas semanas anualizar da números sin sentido (un +2 %
 * en una semana son +180 % al año). Por debajo de este umbral no se calcula.
 */
export const MIN_XIRR_DAYS = 30;

export interface PeriodResult {
  id: PeriodId;
  /** El cierre de este día es el punto de partida del período (su retorno no cuenta). */
  baseDate: string;
  /** Primer día que cuenta: el día hábil siguiente al de base. */
  startDate: string;
  endDate: string;
  /** El período pedido empezaba antes del historial y se recortó. */
  truncated: boolean;
  /** Días de calendario de `baseDate` a `endDate`. */
  days: number;
  twr: Dec | null;
  /** Solo si el período dura más de un año. */
  twrAnnualized: Dec | null;
  xirr: Dec | null;
  benchmarkReturn: Dec | null;
  /** `twr − benchmarkReturn`, en fracción (puntos porcentuales / 100). */
  difference: Dec | null;
  /**
   * Ganancia en dinero del período: `V_fin − V_base − Σ flujos externos (base, fin]`. Incluye lo
   * realizado, lo no realizado, dividendos e intereses, menos comisiones e impuestos. En "Todo"
   * es el valor final menos lo aportado neto.
   */
  gain: Dec;
}

export type PerformanceWarning =
  | { code: "UNPRICED_POSITION"; symbols: string[] }
  | { code: "NO_BASE_DAYS"; days: number }
  | { code: "NO_BENCHMARK" };

export interface PerformanceInput extends SeriesInput {
  /** Cierres ajustados por dividendos (`adj_close`) del benchmark, o `null` si no hay. */
  benchmark: readonly DailyClose[] | null;
}

export interface PerformanceResult {
  series: DailySeries;
  periods: PeriodResult[];
  warnings: PerformanceWarning[];
}

/** Fecha nominal de inicio de un período, o `null` para "todo el historial". */
function nominalBase(id: PeriodId, endDate: string): string | null {
  switch (id) {
    case "1S":
      return addDays(endDate, -7);
    case "1M":
      return addMonths(endDate, -1);
    case "3M":
      return addMonths(endDate, -3);
    case "1A":
      return addMonths(endDate, -12);
    case "YTD":
      return `${yearOf(endDate) - 1}-12-31`;
    case "MAX":
      return null;
  }
}

/** Día base de un período: el último día hábil en o antes del nominal, sin pasar del inicio del historial. */
export function periodBase(
  id: PeriodId,
  endDate: string,
  historyBase: string,
): { baseDate: string; truncated: boolean } {
  const nominal = nominalBase(id, endDate);
  if (nominal === null) return { baseDate: historyBase, truncated: false };
  const base = onOrBeforeWeekday(nominal);
  return base < historyBase
    ? { baseDate: historyBase, truncated: true }
    : { baseDate: base, truncated: false };
}

function benchmarkReturn(
  benchmark: readonly DailyClose[] | null,
  baseDate: string,
  endDate: string,
): Dec | null {
  if (benchmark === null) return null;
  const start = closeOnOrBefore(benchmark, baseDate);
  const end = closeOnOrBefore(benchmark, endDate);
  if (start === null || end === null || !start.close.gt(0)) return null;
  return end.close.div(start.close).minus(1);
}

/** Flujos de un período para el XIRR: el valor al inicio (sale), los aportes y retiros, el valor final (entra). */
function periodFlows(
  series: DailySeries,
  valueByDate: ReadonlyMap<string, Dec>,
  baseDate: string,
  endDate: string,
): DatedFlow[] {
  const flows: DatedFlow[] = [];
  const baseValue = valueByDate.get(baseDate) ?? ZERO;
  if (baseValue.gt(0)) flows.push({ date: baseDate, amount: baseValue.neg() });
  for (const point of series.points) {
    if (
      point.date > baseDate &&
      point.date <= endDate &&
      !point.flow.isZero()
    ) {
      flows.push({ date: point.date, amount: point.flow.neg() });
    }
  }
  const endValue = valueByDate.get(endDate) ?? ZERO;
  if (endValue.gt(0)) flows.push({ date: endDate, amount: endValue });
  return flows;
}

/**
 * Ganancia en dinero de `(baseDate, endDate]`: lo que el valor creció menos lo que se puso o se
 * sacó de afuera. Un depósito hace subir el valor pero no es ganancia; un retiro lo baja y tampoco
 * es pérdida. El día base sin valor (todavía no había portafolio) cuenta como 0.
 */
function periodGain(
  series: DailySeries,
  valueByDate: ReadonlyMap<string, Dec>,
  baseDate: string,
  endDate: string,
): Dec {
  let external = ZERO;
  for (const point of series.points) {
    if (point.date > baseDate && point.date <= endDate) {
      external = external.plus(point.flow);
    }
  }
  const endValue = valueByDate.get(endDate) ?? ZERO;
  const baseValue = valueByDate.get(baseDate) ?? ZERO;
  return endValue.minus(baseValue).minus(external);
}

export function computePerformance(input: PerformanceInput): PerformanceResult {
  return performanceOfSeries(buildDailySeries(input), input.benchmark);
}

/**
 * Las métricas de cada período a partir de una serie ya armada: la de una cuenta
 * (`buildDailySeries`) o la suma de varias (`combineSeries`, «Todo junto»).
 */
export function performanceOfSeries(
  series: DailySeries,
  benchmarkCloses: readonly DailyClose[] | null,
): PerformanceResult {
  const last = series.points[series.points.length - 1];
  if (series.baseDate === null || last === undefined) {
    return { series, periods: [], warnings: [] };
  }
  const endDate = last.date;
  const benchmark =
    benchmarkCloses === null || benchmarkCloses.length === 0
      ? null
      : sortCloses(benchmarkCloses);
  const valueByDate = new Map(series.points.map((p) => [p.date, p.value]));

  const periods = PERIOD_IDS.map((id): PeriodResult => {
    const { baseDate, truncated } = periodBase(id, endDate, series.baseDate!);
    const days = daysBetween(baseDate, endDate);
    const { twr } = computeTwr(series.points, baseDate, endDate);
    const bench = benchmarkReturn(benchmark, baseDate, endDate);
    return {
      id,
      baseDate,
      startDate: series.points.find((p) => p.date > baseDate)?.date ?? baseDate,
      endDate,
      truncated,
      days,
      twr,
      twrAnnualized: annualizeTwr(twr, days),
      xirr:
        days >= MIN_XIRR_DAYS
          ? computeXirr(periodFlows(series, valueByDate, baseDate, endDate))
          : null,
      benchmarkReturn: bench,
      difference: twr !== null && bench !== null ? twr.minus(bench) : null,
      gain: periodGain(series, valueByDate, baseDate, endDate),
    };
  });

  const warnings: PerformanceWarning[] = [];
  if (series.unpricedSymbols.length > 0) {
    warnings.push({
      code: "UNPRICED_POSITION",
      symbols: series.unpricedSymbols,
    });
  }
  if (series.noBaseDays > 0) {
    warnings.push({ code: "NO_BASE_DAYS", days: series.noBaseDays });
  }
  if (benchmark === null) warnings.push({ code: "NO_BENCHMARK" });
  return { series, periods, warnings };
}

export interface CurvePoint {
  date: string;
  /** Valor total del portafolio; `null` en el día base cuando todavía no había nada. */
  value: Dec | null;
  /** TWR acumulado del período, normalizado a 100 en el día base. */
  portfolio: Dec;
  /** Benchmark normalizado a 100 en el mismo día base; `null` si no hay datos. */
  benchmark: Dec | null;
  /** Ganancia acumulada en dinero desde el día base (0 en el día base); ver `PeriodResult.gain`. */
  gain: Dec;
}

/**
 * Los puntos que se dibujan para un período: el día base y cada día hábil hasta el final, con el
 * portafolio (TWR encadenado) y el benchmark en base 100. Usa el mismo encadenamiento que
 * `computeTwr`, así que el último punto es `100 × (1 + TWR)`.
 */
export function periodCurve(
  series: DailySeries,
  benchmark: readonly DailyClose[] | null,
  period: Pick<PeriodResult, "baseDate" | "endDate">,
): CurvePoint[] {
  const sorted = benchmark === null ? null : sortCloses(benchmark);
  const baseClose =
    sorted === null ? null : closeOnOrBefore(sorted, period.baseDate);
  const benchAt = (date: string): Dec | null => {
    if (sorted === null || baseClose === null || !baseClose.close.gt(0))
      return null;
    const close = closeOnOrBefore(sorted, date);
    return close === null ? null : close.close.div(baseClose.close).times(100);
  };

  const hundred = ZERO.plus(100);
  const baseValue =
    series.points.find((p) => p.date === period.baseDate)?.value ?? null;
  const curve: CurvePoint[] = [
    {
      date: period.baseDate,
      value: baseValue,
      portfolio: hundred,
      benchmark: benchAt(period.baseDate),
      gain: ZERO,
    },
  ];
  let index = hundred;
  let external = ZERO;
  for (const point of series.points) {
    if (point.date <= period.baseDate || point.date > period.endDate) continue;
    if (point.growth !== null) index = index.mul(point.growth);
    external = external.plus(point.flow);
    curve.push({
      date: point.date,
      value: point.value,
      portfolio: index,
      benchmark: benchAt(point.date),
      gain: point.value.minus(baseValue ?? ZERO).minus(external),
    });
  }
  return curve;
}
