import { d, marketDay } from "@/lib/engine";
import type { IntradayPoint } from "@/lib/market-data";
import { formatDayMonthKey } from "./chart-format";
import {
  formatDateKey,
  formatMoney,
  formatPercent,
  formatPrice,
} from "./format";
import { formatLocal } from "./time";
import { RANGE_NAME, type ChartRange } from "./range-options";
import { toneOf, type Tone } from "./tone";

// Gráfico de precio de la ficha de un activo con rango variable: 1S (barras de 30 min), 1M (de 1
// hora) y 1A (cierres diarios), con el rango de 52 semanas superpuesto. Puro. El gráfico se dibuja
// por índice (sin el hueco de las noches y los fines de semana): acá se calcula qué marcas lleva
// el eje, la escala, el cambio del período y qué líneas de 52 semanas entran.

export { RANGE_NAME, RANGE_OPTIONS, type ChartRange } from "./range-options";

/** Un punto listo para armar una serie: `day` es el día de rueda (Nueva York), `YYYY-MM-DD`. */
export interface RangeInputPoint {
  label: string;
  day: string;
  close: string;
}

export interface Week52Input {
  low: string | null;
  high: string | null;
}

export interface RangeSeries {
  range: ChartRange;
  /** `intraday`: barras del día; `daily`: cierres diarios (cuando no se pudo traer el detalle). */
  source: "intraday" | "daily";
  points: Array<{ label: string; close: number }>;
  ticks: Array<{ index: number; text: string }>;
  /** Escala del eje Y, con aire arriba y abajo. */
  domain: [number, number];
  /** Cambio entre el primer y el último punto; `null` con menos de dos puntos. */
  change: { text: string; pctText: string; tone: Tone } | null;
  week52: {
    low: number;
    high: number;
    lowText: string;
    highText: string;
    showLow: boolean;
    showHigh: boolean;
    /** De qué lado va la etiqueta de cada línea: el lado donde la curva queda más lejos de ella. */
    highSide: "left" | "right";
    lowSide: "left" | "right";
  } | null;
  /** Para lectores de pantalla. */
  description: string;
}

const MAX_TICKS = 5;
const PAD = 0.08;
/** Aire, como fracción de la franja de 52 semanas, entre el máximo o el mínimo y el borde del gráfico. */
const LABEL_ROOM = 0.1;

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Del lado del gráfico donde la curva está más lejos de una línea horizontal va su etiqueta, para que
 * no se pisen: la del máximo, donde la curva está más baja; la del mínimo, donde está más alta.
 */
function labelSides(closes: readonly number[]): {
  highSide: "left" | "right";
  lowSide: "left" | "right";
} {
  const third = Math.max(1, Math.floor(closes.length / 3));
  const left = mean(closes.slice(0, third));
  const right = mean(closes.slice(-third));
  return {
    highSide: left <= right ? "left" : "right",
    lowSide: left >= right ? "left" : "right",
  };
}

/** Hasta `max` elementos repartidos parejo, siempre con el primero y el último. */
function evenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return Array.from(
    { length: max },
    (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]!,
  );
}

function tickText(range: ChartRange, day: string): string {
  return range === "1y"
    ? `${day.slice(5, 7)}/${day.slice(2, 4)}`
    : formatDayMonthKey(day);
}

function ticksFor(
  range: ChartRange,
  source: RangeSeries["source"],
  points: readonly RangeInputPoint[],
): RangeSeries["ticks"] {
  const indices = points.map((_, index) => index);
  // Con barras del día, la marca va en la primera barra de cada rueda.
  const candidates =
    source === "intraday" && range !== "1y"
      ? indices.filter((i) => i === 0 || points[i]!.day !== points[i - 1]!.day)
      : indices;
  return evenly(candidates, MAX_TICKS).map((index) => ({
    index,
    text: tickText(range, points[index]!.day),
  }));
}

/**
 * La serie de un rango, lista para dibujar. `null` con menos de dos puntos (no hay línea).
 * `week52` es el rango de 52 semanas del proveedor (o, si no vino, el de los cierres): en 1A las dos
 * líneas siempre entran y la escala se estira para incluirlas; en 1S y 1M solo se dibuja una línea
 * si cae dentro de la escala del período (si no, aplastaría la curva y queda solo la barra de rango).
 */
export function buildRangeSeries(input: {
  range: ChartRange;
  source: RangeSeries["source"];
  points: readonly RangeInputPoint[];
  week52: Week52Input;
}): RangeSeries | null {
  const { range, source, points } = input;
  const numeric = points
    .map((p) => ({ label: p.label, close: Number(p.close) }))
    .filter((p) => Number.isFinite(p.close) && p.close > 0);
  // Se recorta sobre lo ya válido: un cierre roto en el medio no descoloca las marcas del eje.
  const clean = points.filter(
    (p) => Number.isFinite(Number(p.close)) && Number(p.close) > 0,
  );
  if (clean.length < 2) return null;

  const closes = numeric.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pad = (max - min) * PAD || max * 0.02;
  let domain: [number, number] = [min - pad, max + pad];

  let week52: RangeSeries["week52"] = null;
  const low = input.week52.low === null ? null : Number(input.week52.low);
  const high = input.week52.high === null ? null : Number(input.week52.high);
  if (
    low !== null &&
    high !== null &&
    Number.isFinite(low) &&
    Number.isFinite(high) &&
    low > 0 &&
    high > low
  ) {
    if (range === "1y") {
      // Aire para la etiqueta de cada línea, que va afuera de la franja del máximo y el mínimo.
      const room = (high - low) * LABEL_ROOM;
      domain = [
        Math.min(domain[0], low - room),
        Math.max(domain[1], high + room),
      ];
    }
    const inside = (value: number) => value >= domain[0] && value <= domain[1];
    week52 = {
      low,
      high,
      lowText: `US$ ${formatPrice(d(input.week52.low!))}`,
      highText: `US$ ${formatPrice(d(input.week52.high!))}`,
      showLow: range === "1y" || inside(low),
      showHigh: range === "1y" || inside(high),
      ...labelSides(closes),
    };
  }

  const first = d(clean[0]!.close);
  const last = d(clean[clean.length - 1]!.close);
  const diff = last.minus(first);
  const tone = toneOf(diff, 2) ?? "flat";
  const change = {
    text: formatMoney(diff, { signed: true }),
    pctText: formatPercent(first.gt(0) ? diff.div(first) : null, {
      signed: true,
    }),
    tone,
  };

  const firstPoint = clean[0]!;
  const lastPoint = clean[clean.length - 1]!;
  return {
    range,
    source,
    points: numeric,
    ticks: ticksFor(range, source, clean),
    domain,
    change,
    week52,
    description: `Gráfico del precio de ${RANGE_NAME[range]}, de ${firstPoint.label} a ${lastPoint.label}: pasó de US$ ${formatPrice(first)} a US$ ${formatPrice(last)} (${change.text}, ${change.pctText}).`,
  };
}

/** Cierres diarios (`date`, `close`) como puntos de una serie; la etiqueta es la fecha completa. */
export function dailyInput(
  series: ReadonlyArray<{ date: string; close: string }>,
): RangeInputPoint[] {
  return series.map((p) => ({
    label: formatDateKey(p.date),
    day: p.date,
    close: p.close,
  }));
}

/** Barras del día (`at`, `close`) como puntos de una serie; la etiqueta lleva fecha y hora de Montevideo. */
export function intradayInput(
  points: readonly IntradayPoint[],
): RangeInputPoint[] {
  return points.map((p) => ({
    label: formatLocal(p.at, "dd/MM HH:mm"),
    day: marketDay(p.at),
    close: p.close,
  }));
}

/**
 * La semana o el mes a partir de cierres diarios, cuando no se pudo traer el detalle del día:
 * los cierres de los últimos 7 o 31 días corridos del último dato.
 */
export function sliceDaily(
  range: Exclude<ChartRange, "1y">,
  points: readonly RangeInputPoint[],
): RangeInputPoint[] {
  const last = points.at(-1);
  if (!last) return [];
  const days = range === "1w" ? 7 : 31;
  const from = new Date(`${last.day}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days);
  const cut = from.toISOString().slice(0, 10);
  return points.filter((p) => p.day > cut);
}
