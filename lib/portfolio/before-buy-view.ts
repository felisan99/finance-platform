import {
  MIN_SHARED_DAYS,
  addDays,
  addMonths,
  alignReturns,
  analyzeFit,
  d,
  priceDrawdown,
  simulateAddition,
  simulateMonthlyPlan,
  typicalMonthlyDeposit,
  type DailyClose,
  type Dec,
  type MonthlyPlanResult,
  type Transaction,
  type ValuedPortfolio,
} from "@/lib/engine";
import { formatDateKey } from "./chart-format";
import {
  formatMoney,
  formatMoneyWhole,
  formatMonthYear,
  formatPercent,
  formatRatio,
} from "./format";
import type { MetricView } from "./performance-view";
import { benchmarkLabel } from "./performance-view";
import { plural } from "./plural";
import { toneOf } from "./tone";

// «Antes de comprar» (ficha de un activo): los cálculos son de `lib/engine/what-if.ts`; acá se
// eligen los montos y los períodos, se escriben las frases y se preparan los números del gráfico.
// El cliente recibe todo ya formateado (no importa `lib/engine`).

/** Montos fijos que se ofrecen además del aporte típico. */
const PRESETS = [500, 1000, 2000, 5000] as const;
const FALLBACK_AMOUNT = 1000;
/** Años de los períodos de la simulación de aportes. */
const WINDOW_YEARS = [1, 3, 5] as const;
/** Un período cuenta como completo si la historia arranca hasta una semana después de su inicio (feriados). */
const WINDOW_TOLERANCE_DAYS = 7;
/** «Todo» solo aparece si agrega al menos esto sobre el período completo más largo. */
const EXTRA_HISTORY_DAYS = 90;
/** Puntos del gráfico: de sobra para 350 px de ancho. */
export const MAX_CHART_POINTS = 180;
/** Una caída del plan desde la que vale la pena hacer la pregunta. */
const QUESTION_DEPTH = d("-0.1");

const SECTOR_LABELS: Record<string, string> = {
  ETF: "ETFs",
  CRYPTO: "Cripto",
  Technology: "Tecnología",
  Healthcare: "Salud",
  "Financial Services": "Servicios financieros",
  "Consumer Cyclical": "Consumo cíclico",
  "Consumer Defensive": "Consumo básico",
  "Communication Services": "Comunicaciones",
  Energy: "Energía",
  "Basic Materials": "Materiales",
  Industrials: "Industria",
  "Real Estate": "Inmobiliario",
  Utilities: "Servicios públicos",
};

/** El sector en español; uno que no conocemos se muestra tal cual. */
export const sectorLabel = (key: string): string => SECTOR_LABELS[key] ?? key;

export interface AmountOption {
  id: string;
  text: string;
  /** Para escalar el gráfico en el cliente (está en dólares por mes). */
  value: number;
}

export interface ImpactRowView {
  label: string;
  before: string;
  after: string;
}

export interface FitView {
  /** La correlación con el resto de la cartera, `0,86`. */
  value: string;
  sentence: string;
  closest: string | null;
}

export interface ImpactView {
  byAmount: Record<string, ImpactRowView[]>;
  fit: FitView | null;
  notes: string[];
}

export interface PlanView {
  heading: string;
  invested: string;
  value: string;
  gain: MetricView;
  benchmark: { text: string; gain: MetricView } | null;
}

export interface ChartPointView {
  date: string;
  /** Por cada dólar aportado por mes: el cliente multiplica por el monto elegido. */
  invested: number;
  value: number;
  benchmark: number | null;
}

export type WindowId = "1A" | "3A" | "5A" | "ALL";

export interface WindowView {
  id: WindowId;
  label: string;
  plans: Record<string, PlanView>;
  worst: string;
  question: boolean;
  priceDrawdown: string | null;
  chart: ChartPointView[];
}

export interface BeforeBuyView {
  symbol: string;
  benchmarkLabel: string | null;
  amounts: AmountOption[];
  defaultAmountId: string;
  typicalNote: string;
  /** `null` si todavía no hay cartera con la que comparar. */
  impact: ImpactView | null;
  windows: WindowView[];
  defaultWindowId: WindowId | null;
  /** Último cierre usado, `25/09/2026`. */
  asOf: string;
}

export interface BeforeBuyInput {
  symbol: string;
  /** `null` si la persona todavía no tiene cuenta. */
  valued: ValuedPortfolio | null;
  transactions: readonly Transaction[];
  /** Sector (o "ETF", "CRYPTO") de cada símbolo, para la fila del grupo. */
  groupOf: (symbol: string) => string | null;
  /** Cierres ajustados por dividendos (`adj_close`) del candidato, hasta 5 años. */
  candidateCloses: readonly DailyClose[];
  /** Cierres ajustados del último año de las posiciones abiertas (puede incluir al candidato). */
  holdingCloses: ReadonlyMap<string, readonly DailyClose[]>;
  benchmark: { symbol: string; closes: readonly DailyClose[] } | null;
  /** Hoy (YYYY-MM-DD, día de mercado). */
  today: string;
}

const metric = (value: Dec | null): MetricView => ({
  text: formatPercent(value, { signed: true }),
  tone: toneOf(value, 4),
});

/** Los montos que se ofrecen: el aporte típico de la persona (si lo hay) y los fijos. */
export function amountOptions(typical: Dec | null): {
  options: AmountOption[];
  defaultId: string;
  note: string;
} {
  const rounded =
    typical !== null && typical.round().gte(1) ? typical.round() : null;
  const chosen = rounded ?? d(String(FALLBACK_AMOUNT));
  const values = [...PRESETS.map((v) => d(String(v)))];
  if (!values.some((v) => v.eq(chosen))) {
    // Reemplaza al fijo más cercano, así siguen siendo cuatro.
    let nearest = 0;
    for (let i = 1; i < values.length; i++) {
      if (
        values[i]!.minus(chosen).abs().lt(values[nearest]!.minus(chosen).abs())
      )
        nearest = i;
    }
    values[nearest] = chosen;
  }
  values.sort((a, b) => a.comparedTo(b));
  return {
    options: values.map((v) => ({
      id: v.toFixed(0),
      text: formatMoneyWhole(v),
      value: v.toNumber(),
    })),
    defaultId: chosen.toFixed(0),
    note:
      rounded === null
        ? `Sin depósitos en los últimos 12 meses: arranca en ${formatMoneyWhole(chosen)}.`
        : `Arranca en tu aporte típico, ${formatMoneyWhole(chosen)}: lo que depositás en un mes (mediana de los últimos 12).`,
  };
}

function monthsBetween(from: string, to: string): number {
  const index = (key: string) =>
    Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
  return index(to) - index(from);
}

const correlationText = (value: number): string =>
  formatRatio(d(value.toFixed(6)));

/** La frase del parecido según la correlación con el resto de la cartera. */
export function fitSentence(value: number): string {
  if (value >= 0.8)
    return "Se mueve casi igual que el resto de tu cartera: suma poca diversificación.";
  if (value >= 0.5)
    return "Se parece bastante a lo que ya tenés: diversifica algo.";
  if (value >= 0)
    return "Se mueve bastante distinto de lo que ya tenés: diversifica.";
  return "Tiende a moverse al revés que tu cartera: diversifica mucho.";
}

function buildImpact(
  input: BeforeBuyInput,
  amounts: AmountOption[],
  end: string,
): ImpactView | null {
  const { valued, symbol, groupOf } = input;
  if (valued === null) return null;
  const first = simulateAddition(valued, symbol, d("1"), groupOf);
  if (first.before === null) return null;

  const closes = new Map(input.holdingCloses);
  closes.set(symbol, input.candidateCloses);
  const from = addMonths(end, -12);
  const aligned = alignReturns(closes, from, end, symbol);

  const byAmount: Record<string, ImpactRowView[]> = {};
  let fit: ReturnType<typeof analyzeFit> | null = null;
  for (const option of amounts) {
    const result = simulateAddition(valued, symbol, d(option.id), groupOf);
    const before = result.before!;
    const after = result.after;
    const current = analyzeFit(aligned, symbol, before.weights, after.weights);
    fit ??= current;

    const rows: ImpactRowView[] = [
      {
        label: `${symbol} en tu cartera`,
        before: formatPercent(before.weights.get(symbol) ?? d("0")),
        after: formatPercent(after.weights.get(symbol) ?? d("0")),
      },
    ];
    if (
      result.group !== null &&
      before.groupWeight !== null &&
      after.groupWeight !== null
    ) {
      rows.push({
        label: sectorLabel(result.group),
        before: formatPercent(before.groupWeight),
        after: formatPercent(after.groupWeight),
      });
    }
    if (after.positions > 3) {
      rows.push({
        label: "Tus 3 posiciones más grandes",
        before: formatPercent(before.top3),
        after: formatPercent(after.top3),
      });
    }
    if (current.volatilityBefore !== null && current.volatilityAfter !== null) {
      rows.push({
        label: "Volatilidad (1 año)",
        before: formatPercent(d(current.volatilityBefore.toFixed(8))),
        after: formatPercent(d(current.volatilityAfter.toFixed(8))),
      });
    }
    byAmount[option.id] = rows;
  }

  const notes: string[] = [];
  if (fit && fit.days < MIN_SHARED_DAYS) {
    notes.push(
      `Para medir el parecido y la volatilidad hacen falta ${MIN_SHARED_DAYS} ruedas en común; hay ${fit.days}.`,
    );
  }
  if (aligned.limitedBy) {
    notes.push(
      `Con datos desde el ${formatDateKey(aligned.limitedBy.since)}: ${aligned.limitedBy.symbol} no tiene más historia.`,
    );
  }
  if (aligned.shortHistory.length > 0) {
    const list = aligned.shortHistory
      .map((h) => `${h.symbol} (desde el ${formatDateKey(h.since)})`)
      .join(", ");
    notes.push(
      `Con poca historia: ${list} no entra${aligned.shortHistory.length === 1 ? "" : "n"} en la volatilidad ni en el parecido.`,
    );
  }
  const missing = aligned.missing.filter((s) => s !== symbol);
  if (missing.length > 0) {
    notes.push(
      `Sin cierres del último año: ${missing.join(", ")} (no entra${missing.length === 1 ? "" : "n"} en la volatilidad ni en el parecido).`,
    );
  }
  if (valued.missingPrices.length > 0) {
    notes.push(
      `Sin precio: ${valued.missingPrices.join(", ")} (no entra${valued.missingPrices.length === 1 ? "" : "n"} en los pesos).`,
    );
  }

  let fitView: FitView | null = null;
  if (fit?.correlation != null) {
    fitView = {
      value: correlationText(fit.correlation),
      sentence: fitSentence(fit.correlation),
      closest:
        fit.closest === null
          ? null
          : `Lo que más se le parece: ${fit.closest.symbol} (${correlationText(fit.closest.correlation)}).`,
    };
  } else if (fit !== null && fit.days >= MIN_SHARED_DAYS) {
    notes.push(
      first.before.weights.size === 0 ||
        [...first.before.weights.keys()].every((s) => s === symbol)
        ? "No hay otra posición con la que compararlo."
        : `Sin historia de ${symbol} en el último año para compararlo.`,
    );
  }

  return { byAmount, fit: fitView, notes };
}

/** Del plan por cada dólar al mes a los puntos del gráfico (con el benchmark alineado por fecha). */
function chartPoints(
  plan: MonthlyPlanResult,
  benchmark: MonthlyPlanResult | null,
): ChartPointView[] {
  const bench = benchmark?.points ?? [];
  let j = -1;
  const all = plan.points.map((point) => {
    while (j + 1 < bench.length && bench[j + 1]!.date <= point.date) j += 1;
    return {
      date: point.date,
      invested: point.invested.toNumber(),
      value: point.value.toNumber(),
      benchmark: j >= 0 ? bench[j]!.value.toNumber() : null,
    };
  });
  if (all.length <= MAX_CHART_POINTS) return all;

  // Se afina de a pasos parejos, sin perder el último día ni el peor momento.
  const keep = new Set<number>([all.length - 1]);
  const step = Math.ceil(all.length / (MAX_CHART_POINTS - 2));
  for (let i = 0; i < all.length; i += step) keep.add(i);
  if (plan.worst) {
    const worstIndex = all.findIndex((p) => p.date === plan.worst!.date);
    if (worstIndex >= 0) keep.add(worstIndex);
  }
  return [...keep].sort((a, b) => a - b).map((i) => all[i]!);
}

function worstText(plan: MonthlyPlanResult): string {
  const worst = plan.worst;
  if (worst === null) return "Nunca estuvo por debajo de lo aportado.";
  const head = `Peor momento: ${formatMonthYear(worst.date)}, lo comprado valía ${formatPercent(worst.depth, { signed: true })} respecto de lo aportado.`;
  if (worst.recoveredDate === null)
    return `${head} Todavía no volvió a lo aportado.`;
  const months = monthsBetween(worst.date, worst.recoveredDate);
  const lapse =
    months === 0
      ? "ese mismo mes"
      : `${months} ${plural(months, "mes", "meses")} después`;
  return `${head} Volvió a lo aportado en ${formatMonthYear(worst.recoveredDate)}, ${lapse}.`;
}

function drawdownText(
  closes: readonly DailyClose[],
  from: string,
  to: string,
): string | null {
  const stat = priceDrawdown(closes, from, to);
  if (stat === null) return null;
  const recovery =
    stat.recoveredDate === null
      ? "todavía sin recuperar"
      : `recuperada en ${formatMonthYear(stat.recoveredDate)}`;
  return `Mayor caída del precio: ${formatPercent(stat.depth, { signed: true })}, de ${formatMonthYear(stat.peakDate)} a ${formatMonthYear(stat.troughDate)} (${recovery}).`;
}

function buildWindows(
  input: BeforeBuyInput,
  amounts: AmountOption[],
  first: string,
  end: string,
): WindowView[] {
  const ranges: Array<{ id: WindowId; label: string; from: string }> = [];
  for (const years of WINDOW_YEARS) {
    // Desde el mes siguiente al de hace N años: 1 año son 12 aportes, no 13.
    const from = `${addMonths(end, 1 - 12 * years).slice(0, 7)}-01`;
    if (first <= addDays(from, WINDOW_TOLERANCE_DAYS)) {
      ranges.push({
        id: `${years}A` as WindowId,
        label: `${years} año${years === 1 ? "" : "s"}`,
        from,
      });
    }
  }
  const longest = ranges.at(-1)?.from ?? end;
  if (
    ranges.length < WINDOW_YEARS.length &&
    first < addDays(longest, -EXTRA_HISTORY_DAYS) &&
    monthsBetween(first, end) >= 1
  ) {
    ranges.push({ id: "ALL", label: "Todo", from: first });
  }

  const benchmark =
    input.benchmark && input.benchmark.symbol !== input.symbol
      ? input.benchmark
      : null;
  const label = benchmark ? benchmarkLabel(benchmark.symbol) : null;
  const one = d("1");

  return ranges.flatMap((range) => {
    const plan = simulateMonthlyPlan(
      input.candidateCloses,
      one,
      range.from,
      end,
    );
    if (plan === null) return [];
    const bench = benchmark
      ? simulateMonthlyPlan(benchmark.closes, one, plan.start, end)
      : null;

    const plans: Record<string, PlanView> = {};
    for (const option of amounts) {
      const amount = d(option.id);
      const invested = plan.invested.mul(amount);
      const value = plan.value.mul(amount);
      const gain = plan.value.div(plan.invested).minus(1);
      plans[option.id] = {
        heading: `${formatMoneyWhole(amount)} por mes desde ${formatMonthYear(plan.start)} (${plan.contributions} ${plural(plan.contributions, "aporte", "aportes")})`,
        invested: formatMoney(invested),
        value: formatMoney(value),
        gain: metric(gain),
        benchmark:
          bench === null || label === null
            ? null
            : {
                text: `Lo mismo en ${label}: ${formatMoney(bench.value.mul(amount))}`,
                gain: metric(bench.value.div(bench.invested).minus(1)),
              },
      };
    }

    return [
      {
        id: range.id,
        label: range.label,
        plans,
        worst: worstText(plan),
        question: plan.worst !== null && plan.worst.depth.lte(QUESTION_DEPTH),
        priceDrawdown: drawdownText(input.candidateCloses, plan.start, end),
        chart: chartPoints(plan, bench),
      },
    ];
  });
}

/**
 * La vista de «Antes de comprar». `null` si el candidato no tiene ningún cierre ajustado (recién
 * agregado: el historial se descarga en segundo plano).
 */
export function buildBeforeBuyView(
  input: BeforeBuyInput,
): BeforeBuyView | null {
  const dates = input.candidateCloses
    .filter((c) => c.close.gt(0))
    .map((c) => c.date)
    .sort();
  const first = dates[0];
  const end = dates.at(-1);
  if (first === undefined || end === undefined) return null;

  const { options, defaultId, note } = amountOptions(
    typicalMonthlyDeposit(input.transactions, input.today),
  );
  const windows = buildWindows(input, options, first, end);

  return {
    symbol: input.symbol,
    benchmarkLabel:
      input.benchmark && input.benchmark.symbol !== input.symbol
        ? benchmarkLabel(input.benchmark.symbol)
        : null,
    amounts: options,
    defaultAmountId: defaultId,
    typicalNote: note,
    impact: buildImpact(input, options, end),
    windows,
    defaultWindowId: windows.at(-1)?.id ?? null,
    asOf: formatDateKey(end),
  };
}
