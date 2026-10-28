import { cashDelta } from "./cash";
import { marketDay } from "./dates";
import { QTY_EPSILON, ZERO, type Dec } from "./decimal";
import { applyTransaction, createLedger, type LedgerState } from "./engine";
import { sortTransactions } from "./ordering";
import { closeOnOrBefore, sortCloses } from "./series";
import type { EngineOptions, Transaction } from "./types";
import type { DailyClose } from "./valuation";

// Qué posiciones movieron la cartera entre dos cierres. Puro.
//
// La contribución de un símbolo es lo que ganó o perdió en el rango, sin contar la plata que se
// le puso o se le sacó: valor final − valor inicial + Σ efecto en efectivo de sus operaciones
// (compras restan, ventas y dividendos suman). Así, sumando todas las contribuciones y lo que no
// es de ningún símbolo (intereses, comisiones e impuestos sueltos), da exactamente el cambio de
// valor menos los depósitos y retiros del rango.
//
// Los días y la valuación son los mismos que los de `buildDailySeries`: una operación cuenta para
// el cierre de un día si su día de mercado es ese o anterior, los cierres guardados se des-ajustan
// con los `SPLIT` del libro que todavía no ocurrieron, y una posición sin ningún cierre se valúa a
// su costo (y se informa en `unpriced`). Por eso `startValue` y `endValue` coinciden con el valor
// de la serie en esos días.

export interface SymbolContribution {
  symbol: string;
  startValue: Dec;
  endValue: Dec;
  /** Σ efecto en efectivo de las operaciones del símbolo en el rango (negativo = se invirtió). */
  cashFlow: Dec;
  /** `endValue − startValue + cashFlow`. */
  contribution: Dec;
}

export interface ContributionResult {
  /** Cierre de partida (YYYY-MM-DD): lo que pasó ese día no entra. */
  from: string;
  /** Último cierre incluido. */
  to: string;
  /** Valor total (posiciones + efectivo) al cierre de `from`. */
  startValue: Dec;
  endValue: Dec;
  /** Σ depósitos − Σ retiros con fecha en `(from, to]`. */
  externalFlows: Dec;
  /** Lo que ganó o perdió la cartera en el rango: `endValue − startValue − externalFlows`. */
  gain: Dec;
  /** Intereses − comisiones − impuestos que no son de ningún símbolo. */
  other: Dec;
  /** De la mayor contribución a la menor (empate: por símbolo). */
  symbols: SymbolContribution[];
  /** Símbolos valuados a costo en `from` o en `to` por no tener cierre. */
  unpriced: string[];
}

export interface ContributionInput {
  /** Transacciones de UNA cuenta. */
  transactions: readonly Transaction[];
  /** Cierres por símbolo, ajustados por splits (como `prices_daily.close`). */
  closes: ReadonlyMap<string, readonly DailyClose[]>;
  from: string;
  to: string;
  options?: EngineOptions;
}

export function contributionBetween(
  input: ContributionInput,
): ContributionResult {
  const { from, to } = input;
  if (from > to) throw new Error("contributionBetween: from es posterior a to");

  const closes = new Map<string, DailyClose[]>();
  for (const [symbol, list] of input.closes)
    closes.set(symbol, sortCloses(list));

  const txs = sortTransactions(input.transactions);
  const splitDays = new Map<string, Array<{ day: string; ratio: Dec }>>();
  for (const tx of txs) {
    if (tx.type !== "SPLIT") continue;
    const list = splitDays.get(tx.symbol) ?? [];
    list.push({ day: marketDay(tx.executedAt), ratio: tx.splitRatio });
    splitDays.set(tx.symbol, list);
  }

  const unpriced = new Set<string>();
  const valueAt = (ledger: LedgerState, day: string): Map<string, Dec> => {
    const values = new Map<string, Dec>();
    for (const [symbol, position] of ledger.positions) {
      if (position.quantity.abs().lt(QTY_EPSILON)) continue;
      const close = closeOnOrBefore(closes.get(symbol) ?? [], day);
      if (close === null) {
        values.set(symbol, position.costBasis);
        unpriced.add(symbol);
        continue;
      }
      const factor = (splitDays.get(symbol) ?? [])
        .filter((split) => split.day > day)
        .reduce((acc, split) => acc.mul(split.ratio), ZERO.plus(1));
      values.set(symbol, position.quantity.mul(close.close.mul(factor)));
    }
    return values;
  };

  let ledger = createLedger();
  let index = 0;
  for (; index < txs.length; index++) {
    const tx = txs[index] as Transaction;
    if (marketDay(tx.executedAt) > from) break;
    ledger = applyTransaction(ledger, tx, input.options);
  }
  const startCash = ledger.cash;
  const startValues = valueAt(ledger, from);

  const cashFlows = new Map<string, Dec>();
  let externalFlows = ZERO;
  let other = ZERO;
  for (; index < txs.length; index++) {
    const tx = txs[index] as Transaction;
    if (marketDay(tx.executedAt) > to) break;
    const issuesBefore = ledger.issues.length;
    ledger = applyTransaction(ledger, tx, input.options);
    // Una operación rechazada por el motor no movió nada.
    if (ledger.issues.length !== issuesBefore) continue;

    if (tx.type === "DEPOSIT") externalFlows = externalFlows.plus(tx.amount);
    else if (tx.type === "WITHDRAWAL")
      externalFlows = externalFlows.minus(tx.amount);
    else if (tx.symbol)
      cashFlows.set(
        tx.symbol,
        (cashFlows.get(tx.symbol) ?? ZERO).plus(cashDelta(tx)),
      );
    else other = other.plus(cashDelta(tx));
  }
  const endValues = valueAt(ledger, to);

  const symbols = new Set([
    ...startValues.keys(),
    ...endValues.keys(),
    ...cashFlows.keys(),
  ]);
  const rows: SymbolContribution[] = [...symbols].map((symbol) => {
    const startValue = startValues.get(symbol) ?? ZERO;
    const endValue = endValues.get(symbol) ?? ZERO;
    const cashFlow = cashFlows.get(symbol) ?? ZERO;
    return {
      symbol,
      startValue,
      endValue,
      cashFlow,
      contribution: endValue.minus(startValue).plus(cashFlow),
    };
  });

  const startValue = sum([...startValues.values()]).plus(startCash);
  const endValue = sum([...endValues.values()]).plus(ledger.cash);
  return {
    from,
    to,
    startValue,
    endValue,
    externalFlows,
    gain: endValue.minus(startValue).minus(externalFlows),
    other,
    symbols: sortContributions(rows),
    unpriced: [...unpriced].sort(),
  };
}

/**
 * «Todo junto»: suma las contribuciones calculadas cuenta por cuenta (nunca se mezclan las
 * transacciones de varias cuentas en un mismo libro). Todas deben tener el mismo rango.
 */
export function combineContributions(
  list: readonly ContributionResult[],
): ContributionResult | null {
  const first = list[0];
  if (!first) return null;
  if (list.some((r) => r.from !== first.from || r.to !== first.to)) {
    throw new Error("combineContributions: rangos distintos");
  }
  const bySymbol = new Map<string, SymbolContribution>();
  for (const result of list) {
    for (const row of result.symbols) {
      const current = bySymbol.get(row.symbol);
      bySymbol.set(
        row.symbol,
        current
          ? {
              symbol: row.symbol,
              startValue: current.startValue.plus(row.startValue),
              endValue: current.endValue.plus(row.endValue),
              cashFlow: current.cashFlow.plus(row.cashFlow),
              contribution: current.contribution.plus(row.contribution),
            }
          : row,
      );
    }
  }
  return {
    from: first.from,
    to: first.to,
    startValue: sum(list.map((r) => r.startValue)),
    endValue: sum(list.map((r) => r.endValue)),
    externalFlows: sum(list.map((r) => r.externalFlows)),
    gain: sum(list.map((r) => r.gain)),
    other: sum(list.map((r) => r.other)),
    symbols: sortContributions([...bySymbol.values()]),
    unpriced: [...new Set(list.flatMap((r) => r.unpriced))].sort(),
  };
}

function sortContributions(rows: SymbolContribution[]): SymbolContribution[] {
  return rows.sort((a, b) => {
    const byValue = b.contribution.comparedTo(a.contribution);
    return byValue !== 0 ? byValue : a.symbol < b.symbol ? -1 : 1;
  });
}

function sum(values: readonly Dec[]): Dec {
  return values.reduce((acc, value) => acc.plus(value), ZERO);
}
