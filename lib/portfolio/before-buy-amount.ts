// «Antes de comprar» con cualquier monto, en el cliente: la persona elige un monto fijo o escribe
// uno («Otro») y la tarjeta se recalcula sin ir al servidor. El servidor manda lo que no depende del
// monto (los valores de hoy de la cartera, las varianzas y el plan por cada dólar al mes, todo ya
// medido por el motor) y acá solo se escala y se formatea. Sin imports pesados a propósito: lo usa el
// componente de cliente y no tiene que arrastrar el motor (decimal.js) al navegador.

import {
  formatChartMoney,
  formatChartMoneyWhole,
  formatChartShare,
} from "./chart-format";
import type { Tone } from "./tone";

/** El id del aporte típico entre los montos (los fijos usan el monto: `"500"`). */
export const TYPICAL_AMOUNT_ID = "typical";

export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 1_000_000;

export type AmountInput =
  { ok: true; value: number } | { ok: false; message: string };

const EMPTY_MESSAGE = "Escribí un monto en dólares.";
const FORMAT_MESSAGE = "Escribí solo el número, por ejemplo 1.500 o 1500,50.";
const RANGE_MESSAGE = `El monto va de ${formatChartMoneyWhole(MIN_AMOUNT)} a ${formatChartMoneyWhole(MAX_AMOUNT)}.`;

/** Una parte entera con separador de miles (`1.500.000`) o sin él (`1500000`). */
function integerPart(text: string, thousands: string | null): string | null {
  if (thousands === null || !text.includes(thousands)) {
    return /^\d*$/.test(text) ? text : null;
  }
  const groups = text.split(thousands);
  const [head, ...rest] = groups;
  if (!head || !/^\d{1,3}$/.test(head)) return null;
  if (!rest.every((group) => /^\d{3}$/.test(group))) return null;
  return groups.join("");
}

/**
 * Lo que la persona escribe en «Otro» → dólares enteros. Acepta la forma de acá (`1.500,50`) y la de
 * la calculadora (`1500.5`), con o sin `US$`: si aparecen los dos separadores, el último es el
 * decimal; una coma sola es decimal; un punto solo es de miles si le siguen exactamente tres cifras
 * (`1.500`) y decimal si no (`12.5`). Se redondea al dólar y tiene que quedar entre `MIN_AMOUNT` y
 * `MAX_AMOUNT`; si no, el mensaje que se muestra debajo del campo.
 */
export function parseAmount(raw: string): AmountInput {
  const text = raw.replace(/US\$|USD|\$/gi, "").replace(/\s/g, "");
  if (text === "") return { ok: false, message: EMPTY_MESSAGE };
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) {
    return { ok: false, message: FORMAT_MESSAGE };
  }

  const dots = text.split(".").length - 1;
  const commas = text.split(",").length - 1;
  let decimal: "." | "," | null = null;
  let thousands: "." | "," | null = null;
  if (dots > 0 && commas > 0) {
    decimal = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    thousands = decimal === "," ? "." : ",";
  } else if (commas === 1) {
    decimal = ",";
  } else if (commas > 1) {
    thousands = ",";
  } else if (dots === 1) {
    if (/^[1-9]\d{0,2}\.\d{3}$/.test(text)) thousands = ".";
    else decimal = ".";
  } else if (dots > 1) {
    thousands = ".";
  }

  let whole = text;
  let fraction = "";
  if (decimal !== null) {
    const at = text.lastIndexOf(decimal);
    if (text.indexOf(decimal) !== at) {
      return { ok: false, message: FORMAT_MESSAGE };
    }
    whole = text.slice(0, at);
    fraction = text.slice(at + 1);
    if (!/^\d*$/.test(fraction)) return { ok: false, message: FORMAT_MESSAGE };
  }
  const digits = integerPart(whole, thousands);
  if (digits === null) return { ok: false, message: FORMAT_MESSAGE };

  const exact = Number(`${digits || "0"}.${fraction || "0"}`);
  const value = Math.round(exact);
  if (!Number.isFinite(exact) || exact < MIN_AMOUNT || value > MAX_AMOUNT) {
    return { ok: false, message: RANGE_MESSAGE };
  }
  return { ok: true, value };
}

// --- Qué le hace a tu cartera ---------------------------------------------------------------------

export interface ImpactRowView {
  label: string;
  before: string;
  after: string;
}

/** Lo que no depende del monto, para recalcular las filas con cualquiera (los montos en dólares). */
export interface ImpactModel {
  symbol: string;
  /** Total de hoy: posiciones con precio más el efectivo (el negativo cuenta como 0). Positivo. */
  total: number;
  /** Lo que vale hoy el candidato en la cartera (0 si no lo tiene). */
  candidate: number;
  /** El grupo del candidato (sector, ETFs…) y lo que vale hoy, con el candidato; `null` sin grupo. */
  group: { label: string; value: number } | null;
  /** Lo que valen hoy las demás posiciones con precio. */
  others: number[];
  /** Varianzas y covarianza anualizadas (`volatilityModel` del motor); `null` si no se puede medir. */
  volatility: {
    portfolio: number;
    covariance: number;
    candidate: number;
  } | null;
}

const topThree = (values: readonly number[]): number =>
  [...values]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((sum, value) => sum + value, 0);

/** Las filas de antes y después de comprar `amount` dólares del candidato con plata nueva. */
export function impactRows(
  model: ImpactModel,
  amount: number,
): ImpactRowView[] {
  if (!(model.total > 0) || !(amount > 0)) return [];
  const after = model.total + amount;
  const row = (label: string, before: number, later: number) => ({
    label,
    before: formatChartShare(before / model.total),
    after: formatChartShare(later / after),
  });

  const rows = [
    row(
      `${model.symbol} en tu cartera`,
      model.candidate,
      model.candidate + amount,
    ),
  ];
  if (model.group !== null) {
    rows.push(
      row(model.group.label, model.group.value, model.group.value + amount),
    );
  }
  if (model.others.length + 1 > 3) {
    rows.push(
      row(
        "Tus 3 posiciones más grandes",
        topThree([...model.others, model.candidate]),
        topThree([...model.others, model.candidate + amount]),
      ),
    );
  }
  const volatility = model.volatility;
  if (volatility !== null) {
    const x = amount / model.total;
    const variance =
      volatility.portfolio +
      2 * x * volatility.covariance +
      x * x * volatility.candidate;
    rows.push({
      label: "Volatilidad (1 año)",
      before: formatChartShare(Math.sqrt(Math.max(0, volatility.portfolio))),
      after: formatChartShare(Math.sqrt(Math.max(0, variance)) / (1 + x)),
    });
  }
  return rows;
}

// --- ¿Lo habrías aguantado? -----------------------------------------------------------------------

interface Metric {
  text: string;
  tone: Tone | null;
}

/** Un período de la simulación de aportes, por cada dólar al mes (el porcentaje no depende del monto). */
export interface PlanModel {
  /** `desde 10/2025 (12 aportes)`. */
  since: string;
  invested: number;
  value: number;
  gain: Metric;
  benchmark: { label: string; value: number; gain: Metric } | null;
}

export interface PlanView {
  heading: string;
  invested: string;
  value: string;
  gain: Metric;
  benchmark: { text: string; gain: Metric } | null;
}

/** Los textos de un período con `amount` dólares por mes. */
export function planView(plan: PlanModel, amount: number): PlanView {
  return {
    heading: `${formatChartMoneyWhole(amount)} por mes ${plan.since}`,
    invested: formatChartMoney(plan.invested * amount),
    value: formatChartMoney(plan.value * amount),
    gain: plan.gain,
    benchmark:
      plan.benchmark === null
        ? null
        : {
            text: `Lo mismo en ${plan.benchmark.label}: ${formatChartMoney(plan.benchmark.value * amount)}`,
            gain: plan.benchmark.gain,
          },
  };
}
