import {
  isWeekday,
  marketDay,
  onOrAfterWeekday,
  previousWeekday,
  weekdaysBetween,
} from "./dates";
import { QTY_EPSILON, ZERO, type Dec } from "./decimal";
import { applyTransaction, createLedger } from "./engine";
import { sortTransactions } from "./ordering";
import type { EngineOptions, Transaction } from "./types";
import type { DailyClose } from "./valuation";

// Serie histórica diaria del portafolio (spec §6.4): para cada día hábil desde la primera
// transacción, las cantidades y el efectivo a ese día valuados con los cierres de `prices_daily`.
// Pura: los cierres, la fecha final y las opciones entran por parámetro.
//
// La grilla son los días hábiles (así los retornos diarios son comparables con los de las acciones
// y se anualizan con 252 ruedas). La cripto cotiza también el fin de semana: si la serie termina
// un sábado o un domingo, ese día es el último punto (lo que se movió desde el viernes queda a la
// vista, como el valor de Inicio); al llegar el lunes deja de ser el final y desaparece solo, y el
// lunes absorbe el movimiento del fin de semana.

export interface SeriesPoint {
  /** Día de mercado (YYYY-MM-DD, hora de Nueva York). */
  date: string;
  /** Valor total al cierre: posiciones + efectivo. */
  value: Dec;
  cash: Dec;
  marketValue: Dec;
  /** Flujo externo neto del día: Σ depósitos − Σ retiros (spec §6.5). */
  flow: Dec;
  /**
   * `1 + r_t` con `r_t = V_t / (V_{t−1} + F_t) − 1` (convención: el flujo ocurre al inicio del día
   * y forma parte de su base). `null` si la base es ≤ 0 (antes del primer depósito o con la cuenta
   * vaciada): ese día no aporta retorno.
   */
  growth: Dec | null;
  /** Posiciones sin ningún cierre anterior ese día: se valuaron a su costo. */
  unpriced: string[];
}

export interface DailySeries {
  points: SeriesPoint[];
  /** Día hábil anterior al primero de la serie: el "cierre" en el que el valor todavía era 0. `null` si la serie está vacía. */
  baseDate: string | null;
  /** Símbolos que en algún día se valuaron a costo por falta de precio. */
  unpricedSymbols: string[];
  /** Días sin retorno por base ≤ 0. */
  noBaseDays: number;
}

export interface SeriesInput {
  transactions: readonly Transaction[];
  /** Cierres diarios por símbolo, ajustados por splits hasta hoy (como los guarda `prices_daily`). */
  closes: ReadonlyMap<string, readonly DailyClose[]>;
  /** Último día de la serie (YYYY-MM-DD). Las operaciones posteriores no se aplican. */
  endDate: string;
  options?: EngineOptions;
}

/** El último cierre en o antes de `date` (búsqueda binaria; `closes` ordenado por fecha), o `null`. */
export function closeOnOrBefore(
  closes: readonly DailyClose[],
  date: string,
): DailyClose | null {
  let low = 0;
  let high = closes.length - 1;
  let found: DailyClose | null = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = closes[mid] as DailyClose;
    if (candidate.date <= date) {
      found = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export const sortCloses = (closes: readonly DailyClose[]): DailyClose[] =>
  [...closes].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

interface Dated {
  tx: Transaction;
  /**
   * Día de la grilla en el que la operación empieza a valer: el de Nueva York, o el lunes si cayó en
   * fin de semana (o el último día, si la serie termina en ese fin de semana).
   */
  day: string;
}

/**
 * Reconstruye el valor del portafolio día por día.
 *
 * Los cierres guardados están ajustados por splits hacia atrás, y las cantidades del libro no (el
 * motor aplica cada `SPLIT` en su fecha). Para que precio y cantidad estén en las mismas unidades,
 * cada cierre se multiplica por la razón de los `SPLIT` del libro que todavía no ocurrieron ese
 * día. Un día sin ningún cierre anterior para una posición abierta se valúa a su costo (ganancia
 * no realizada cero) y se informa en `unpriced`.
 */
export function buildDailySeries(input: SeriesInput): DailySeries {
  const empty: DailySeries = {
    points: [],
    baseDate: null,
    unpricedSymbols: [],
    noBaseDays: 0,
  };

  const dated: Dated[] = sortTransactions(input.transactions)
    .map((tx) => {
      const own = marketDay(tx.executedAt);
      const day = onOrAfterWeekday(own);
      // Un fin de semana en el que termina la serie: la operación vale en ese último punto.
      return {
        tx,
        day: day > input.endDate && own <= input.endDate ? input.endDate : day,
      };
    })
    .filter((item) => item.day <= input.endDate);
  const first = dated[0];
  if (!first) return empty;

  const days = weekdaysBetween(first.day, input.endDate);
  if (!isWeekday(input.endDate)) days.push(input.endDate);

  const closes = new Map<string, DailyClose[]>();
  for (const [symbol, list] of input.closes)
    closes.set(symbol, sortCloses(list));

  // Splits del libro por símbolo, con el día en que empiezan a valer.
  const splits = new Map<string, Array<{ day: string; ratio: Dec }>>();
  for (const { tx, day } of dated) {
    if (tx.type !== "SPLIT") continue;
    const list = splits.get(tx.symbol) ?? [];
    list.push({ day, ratio: tx.splitRatio });
    splits.set(tx.symbol, list);
  }
  const pendingSplitFactor = (symbol: string, day: string): Dec =>
    (splits.get(symbol) ?? [])
      .filter((split) => split.day > day)
      .reduce((acc, split) => acc.mul(split.ratio), ZERO.plus(1));

  let ledger = createLedger();
  let next = 0;
  let previousValue = ZERO;
  const points: SeriesPoint[] = [];
  const unpricedSymbols = new Set<string>();
  let noBaseDays = 0;

  for (const day of days) {
    let flow = ZERO;
    while (next < dated.length && (dated[next] as Dated).day <= day) {
      const { tx } = dated[next] as Dated;
      const issuesBefore = ledger.issues.length;
      ledger = applyTransaction(ledger, tx, input.options);
      // Una operación rechazada por el motor no movió nada: tampoco cuenta como flujo.
      if (ledger.issues.length === issuesBefore) {
        if (tx.type === "DEPOSIT") flow = flow.plus(tx.amount);
        else if (tx.type === "WITHDRAWAL") flow = flow.minus(tx.amount);
      }
      next++;
    }

    let marketValue = ZERO;
    const unpriced: string[] = [];
    for (const [symbol, position] of ledger.positions) {
      if (position.quantity.abs().lt(QTY_EPSILON)) continue;
      const close = closeOnOrBefore(closes.get(symbol) ?? [], day);
      if (close === null) {
        marketValue = marketValue.plus(position.costBasis);
        unpriced.push(symbol);
        unpricedSymbols.add(symbol);
      } else {
        const price = close.close.mul(pendingSplitFactor(symbol, day));
        marketValue = marketValue.plus(position.quantity.mul(price));
      }
    }

    const value = marketValue.plus(ledger.cash);
    const base = previousValue.plus(flow);
    let growth: Dec | null = null;
    if (base.gt(0)) growth = value.div(base);
    else noBaseDays++;

    points.push({
      date: day,
      value,
      cash: ledger.cash,
      marketValue,
      flow,
      growth,
      unpriced: unpriced.sort(),
    });
    previousValue = value;
  }

  return {
    points,
    baseDate: previousWeekday(first.day),
    unpricedSymbols: [...unpricedSymbols].sort(),
    noBaseDays,
  };
}
