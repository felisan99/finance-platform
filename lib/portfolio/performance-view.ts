import {
  MIN_VOLATILITY_DAYS,
  MIN_XIRR_DAYS,
  computeMonthlyReturns,
  computeRisk,
  d,
  periodCurve,
  type DailyClose,
  type Dec,
  type PerformanceResult,
  type PerformanceWarning,
  type PeriodId,
  type PeriodResult,
  type RiskResult,
} from "@/lib/engine";
import { formatDateKey, formatDayMonthKey } from "./chart-format";
import {
  EMPTY,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPoints,
} from "./format";
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
  /** Ganancia acumulada del período en USD (0 en el día base). */
  gain: number;
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
  /** Ganancia en dinero del período (valor final − valor inicial − aportes netos), con signo. */
  gain: MetricView;
  points: CurvePointView[];
}

/** Un mes del gráfico de barras: porcentajes (5,06 = +5,06 %) para dibujar y textos para leer. */
export interface MonthlyBarView {
  /** `YYYY-MM` */
  month: string;
  /** Mes abreviado para el eje: `mar`. */
  label: string;
  /** `marzo de 2026` (tooltip y tabla). */
  title: string;
  portfolio: number | null;
  benchmark: number | null;
  portfolioText: string;
  portfolioTone: Tone | null;
  benchmarkText: string;
  benchmarkTone: Tone | null;
  /** `desde el 06/03` / `en curso`, o `null` si el mes está completo. */
  note: string | null;
}

export interface RiskView {
  /** Desde cuándo cuenta, `dd/mm/aaaa`. */
  since: string;
  /** Días con retorno que entraron. */
  days: number;
  maxDrawdown: MetricView;
  /** Cuándo fue y si se recuperó; `null` si no hubo caídas. */
  maxDrawdownDetail: string | null;
  currentDrawdown: MetricView;
  volatility: MetricView;
  /** `false` con pocos días: no se calcula. */
  hasVolatility: boolean;
  /** Por qué no hay volatilidad, si no la hay. */
  volatilityHint: string | null;
  bestDay: MetricView;
  bestDayDate: string;
  worstDay: MetricView;
  worstDayDate: string;
  /** Distancia al máximo día por día, en % (≤ 0), para el gráfico de caídas. */
  curve: Array<{ date: string; drawdown: number }>;
  /** Advertencia de poca historia, o `null`. */
  note: string | null;
}

export interface PerformanceView {
  periods: PeriodView[];
  /** "S&P 500" para SPY; otro símbolo se muestra tal cual. */
  benchmarkLabel: string;
  hasBenchmark: boolean;
  /** Rendimiento por mes de los últimos 12 meses con datos. */
  monthly: MonthlyBarView[];
  /** Riesgo de todo el historial; `null` si no hay días con retorno. */
  risk: RiskView | null;
  /** Fecha del último cierre que entra en la serie, `dd/mm/aaaa`. */
  asOf: string;
  /**
   * `dd/mm/aaaa hh:mm` de la cotización que hace de último punto cuando es más nueva que el último
   * cierre (`live-series.ts`); `null` si la serie llega hasta un cierre.
   */
  live: string | null;
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

/** Meses que muestra el gráfico de barras (un año hacia atrás). */
export const MONTHLY_BARS = 12;

const monthShort = new Intl.DateTimeFormat("es-UY", {
  month: "short",
  timeZone: "UTC",
});
const monthLong = new Intl.DateTimeFormat("es-UY", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
/** El mes abreviado de es-UY viene como `Set.`: en el eje va en minúscula y sin punto. */
const monthLabel = (month: string) =>
  monthShort
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace(/\.$/, "")
    .toLowerCase();
/** `setiembre de 2026` → `Setiembre de 2026`. */
const monthTitle = (month: string) => {
  const text = monthLong.format(new Date(`${month}-01T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const percentNumber = (fraction: Dec): number => fraction.mul(100).toNumber();

function buildMonthlyBars(
  result: PerformanceResult,
  benchmark: readonly DailyClose[] | null,
  firstDate: string | null,
  live: boolean,
): MonthlyBarView[] {
  return computeMonthlyReturns(result.series, benchmark)
    .slice(-MONTHLY_BARS)
    .map((m): MonthlyBarView => {
      const notes: string[] = [];
      if (m.startsMidMonth && firstDate !== null) {
        notes.push(`desde el ${formatDayMonthKey(firstDate)}`);
      }
      if (m.inProgress)
        notes.push(live ? "en curso, con la cotización de hoy" : "en curso");
      return {
        month: m.month,
        label: monthLabel(m.month),
        title: monthTitle(m.month),
        portfolio: m.portfolio === null ? null : percentNumber(m.portfolio),
        benchmark: m.benchmark === null ? null : percentNumber(m.benchmark),
        portfolioText: metric(m.portfolio).text,
        portfolioTone: metric(m.portfolio).tone,
        benchmarkText: metric(m.benchmark).text,
        benchmarkTone: metric(m.benchmark).tone,
        note: notes.length === 0 ? null : notes.join(", "),
      };
    });
}

/** Con menos de un año de ruedas la volatilidad y la caída máxima son orientativas. */
const RISK_RELIABLE_DAYS = 252;

function buildRiskView(
  risk: RiskResult,
  all: PeriodResult,
  live: boolean,
): RiskView {
  const drawdown = risk.maxDrawdown;
  const volatility =
    risk.volatility === null ? null : d(risk.volatility.toFixed(8));
  return {
    since: formatDateKey(all.startDate),
    days: risk.days,
    maxDrawdown:
      drawdown === null
        ? { text: "Sin caídas", tone: "flat" }
        : {
            text: formatPercent(drawdown.depth, { signed: true }),
            tone: toneOf(drawdown.depth, 4),
          },
    maxDrawdownDetail:
      drawdown === null
        ? null
        : `${formatDayMonthKey(drawdown.peakDate)} → ${formatDayMonthKey(drawdown.troughDate)} · ${
            drawdown.recoveredDate === null
              ? "sin recuperar"
              : `recuperada el ${formatDayMonthKey(drawdown.recoveredDate)}`
          }`,
    currentDrawdown: risk.currentDrawdown.isZero()
      ? { text: "En máximos", tone: "gain" }
      : {
          text: formatPercent(risk.currentDrawdown, { signed: true }),
          tone: toneOf(risk.currentDrawdown, 4),
        },
    volatility:
      volatility === null
        ? { text: EMPTY, tone: null }
        : { text: formatPercent(volatility), tone: null },
    hasVolatility: volatility !== null,
    volatilityHint:
      volatility === null
        ? `Hacen falta ${MIN_VOLATILITY_DAYS} días con datos (hay ${risk.days})`
        : null,
    bestDay: metric(risk.bestDay?.value ?? null),
    bestDayDate: risk.bestDay ? formatDateKey(risk.bestDay.date) : EMPTY,
    worstDay: metric(risk.worstDay?.value ?? null),
    worstDayDate: risk.worstDay ? formatDateKey(risk.worstDay.date) : EMPTY,
    curve: risk.curve.map((point) => ({
      date: point.date,
      drawdown: percentNumber(point.drawdown),
    })),
    note:
      [
        risk.days < RISK_RELIABLE_DAYS
          ? "Con menos de un año de historia estos números son orientativos."
          : null,
        live
          ? "Incluye la cotización de hoy, que todavía no es un cierre: el mejor y el peor día pueden cambiar al terminar la rueda."
          : null,
      ]
        .filter((text) => text !== null)
        .join(" ") || null,
  };
}

/**
 * Arma la vista de Rendimiento. `benchmark` son los cierres ajustados por dividendos del
 * benchmark (los mismos que se le pasaron al motor). `null` si no hay serie que mostrar.
 */
export function buildPerformanceView(input: {
  result: PerformanceResult;
  benchmark: readonly DailyClose[] | null;
  benchmarkSymbol: string | null;
  /** Hay un punto en vivo al final de la serie: de cuándo es la cotización y el último cierre real. */
  live?: { asOf: Date; lastCloseDate: string } | null;
}): PerformanceView | null {
  const { result, benchmark, benchmarkSymbol } = input;
  const live = input.live ?? null;
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
      gain: {
        text: formatMoney(period.gain, { signed: true }),
        tone: toneOf(period.gain, 2),
      },
      points: periodCurve(result.series, benchmark, period).map((point) => ({
        date: point.date,
        value: point.value === null ? null : toNumber(point.value),
        portfolio: toNumber(point.portfolio),
        benchmark: point.benchmark === null ? null : toNumber(point.benchmark),
        gain: toNumber(point.gain),
      })),
    };
  });

  const all = result.periods.find((p) => p.id === "MAX");
  const risk =
    all === undefined
      ? null
      : computeRisk(result.series.points, all.baseDate, all.endDate);
  const first = result.series.points[0];

  return {
    periods,
    benchmarkLabel: benchmarkLabel(benchmarkSymbol),
    hasBenchmark: !result.warnings.some((w) => w.code === "NO_BENCHMARK"),
    monthly: buildMonthlyBars(
      result,
      benchmark,
      first?.date ?? null,
      live !== null,
    ),
    risk:
      risk === null || all === undefined
        ? null
        : buildRiskView(risk, all, live !== null),
    asOf: formatDateKey(live ? live.lastCloseDate : last.date),
    live: live ? formatDateTime(live.asOf) : null,
    notes: result.warnings.flatMap((w) => noteOf(w) ?? []),
  };
}
