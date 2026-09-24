import {
  MIN_XIRR_DAYS,
  periodCurve,
  type DailyClose,
  type Dec,
  type PerformanceResult,
  type PerformanceWarning,
  type PeriodId,
  type PeriodResult,
} from "@/lib/engine";
import { formatDateKey } from "./chart-format";
import { EMPTY, formatPercent, formatPoints } from "./format";
import { toneOf, type Tone } from "./tone";

// Rendimiento para la pantalla (spec §10.1): el cálculo es de `lib/engine/performance.ts`; acá se
// formatea (es-UY), se le pone tono a cada dato y se recortan las curvas por período. El cliente
// solo cambia de período: no recibe decimales sino textos y `number` para dibujar.

export const PERIOD_LABELS: Record<PeriodId, string> = {
  "1S": "1S",
  "1M": "1M",
  "3M": "3M",
  YTD: "YTD",
  "1A": "1A",
  MAX: "Todo",
};

export interface MetricView {
  text: string;
  /** `null`: sin dato. */
  tone: Tone | null;
}

export interface CurvePointView {
  date: string;
  /** Valor total en USD; `null` en el día base cuando todavía no había portafolio. */
  value: number | null;
  /** TWR acumulado del período, base 100. */
  portfolio: number;
  /** Benchmark base 100; `null` si no hay datos. */
  benchmark: number | null;
}

export interface PeriodView {
  id: PeriodId;
  label: string;
  /** Desde cuándo cuenta el período, `dd/mm/aaaa`. */
  since: string;
  /** El período pedido era más largo que el historial: es "todo el historial". */
  truncated: boolean;
  twr: MetricView;
  /** Solo si el período dura más de un año. */
  twrAnnualized: MetricView | null;
  xirr: MetricView;
  /** Por qué no hay XIRR, si no lo hay. */
  xirrHint: string | null;
  benchmark: MetricView;
  difference: MetricView;
  points: CurvePointView[];
}

export interface PerformanceView {
  periods: PeriodView[];
  /** "S&P 500" para SPY; otro símbolo se muestra tal cual. */
  benchmarkLabel: string;
  hasBenchmark: boolean;
  /** Fecha del último cierre que entra en la serie, `dd/mm/aaaa`. */
  asOf: string;
  /** Avisos sobre los datos, ya redactados. */
  notes: string[];
}

export function benchmarkLabel(symbol: string | null): string {
  if (symbol === null) return "Benchmark";
  return symbol === "SPY" ? "S&P 500" : symbol;
}

function metric(value: Dec | null): MetricView {
  if (value === null) return { text: EMPTY, tone: null };
  return {
    text: formatPercent(value, { signed: true }),
    tone: toneOf(value, 4),
  };
}

function xirrHint(period: PeriodResult): string | null {
  if (period.xirr !== null) return null;
  return period.days < MIN_XIRR_DAYS
    ? "Muy corto para una tasa anual"
    : "Sin datos suficientes";
}

function noteOf(warning: PerformanceWarning): string | null {
  switch (warning.code) {
    case "UNPRICED_POSITION":
      return `Faltan precios históricos de ${warning.symbols.join(", ")} en algunos días: esos días se valuaron a costo.`;
    case "NO_BASE_DAYS":
      return warning.days === 1
        ? "Hay 1 día sin base para calcular el rendimiento (por ejemplo, una compra antes del primer depósito): no cuenta."
        : `Hay ${warning.days} días sin base para calcular el rendimiento (por ejemplo, compras antes del primer depósito): no cuentan.`;
    case "NO_BENCHMARK":
      return null;
  }
}

function toNumber(value: Dec): number {
  return value.toNumber();
}

/**
 * Arma la vista de Rendimiento. `benchmark` son los cierres ajustados por dividendos del
 * benchmark (los mismos que se le pasaron al motor). `null` si no hay serie que mostrar.
 */
export function buildPerformanceView(input: {
  result: PerformanceResult;
  benchmark: readonly DailyClose[] | null;
  benchmarkSymbol: string | null;
}): PerformanceView | null {
  const { result, benchmark, benchmarkSymbol } = input;
  const last = result.series.points.at(-1);
  if (result.periods.length === 0 || last === undefined) return null;

  const periods = result.periods.map((period): PeriodView => {
    const showsStart = period.id === "MAX" || period.truncated;
    const annualized =
      period.twrAnnualized === null ? null : metric(period.twrAnnualized);
    return {
      id: period.id,
      label: PERIOD_LABELS[period.id],
      since: formatDateKey(showsStart ? period.startDate : period.baseDate),
      truncated: period.truncated,
      twr: metric(period.twr),
      twrAnnualized: annualized,
      xirr: metric(period.xirr),
      xirrHint: xirrHint(period),
      benchmark: metric(period.benchmarkReturn),
      difference: {
        text: formatPoints(period.difference),
        tone: toneOf(period.difference, 4),
      },
      points: periodCurve(result.series, benchmark, period).map((point) => ({
        date: point.date,
        value: point.value === null ? null : toNumber(point.value),
        portfolio: toNumber(point.portfolio),
        benchmark: point.benchmark === null ? null : toNumber(point.benchmark),
      })),
    };
  });

  return {
    periods,
    benchmarkLabel: benchmarkLabel(benchmarkSymbol),
    hasBenchmark: !result.warnings.some((w) => w.code === "NO_BENCHMARK"),
    asOf: formatDateKey(last.date),
    notes: result.warnings.flatMap((w) => noteOf(w) ?? []),
  };
}
