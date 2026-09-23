import { cashDelta } from "./cash";
import { ZERO, type Dec } from "./decimal";
import { sortTransactions } from "./ordering";
import {
  applyBuy,
  applyDividend,
  applySell,
  applySplit,
  emptyPosition,
  toPosition,
  type PositionState,
} from "./positions";
import type {
  CostMethod,
  EngineIssue,
  EngineOptions,
  EngineResult,
  EngineTotals,
  Transaction,
} from "./types";

/** Acumuladores de efectivo que no pertenecen a ningún símbolo. */
interface CashFlows {
  readonly deposits: Dec;
  readonly withdrawals: Dec;
  readonly interest: Dec;
  readonly fees: Dec;
  readonly taxes: Dec;
}

/** Estado del libro mayor de UNA cuenta. Inmutable: cada paso devuelve uno nuevo. */
export interface LedgerState {
  readonly positions: ReadonlyMap<string, PositionState>;
  readonly cash: Dec;
  readonly flows: CashFlows;
  readonly issues: readonly EngineIssue[];
}

interface ResolvedOptions {
  costMethod: CostMethod;
  currency: string;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  costMethod: "AVERAGE",
  currency: "USD",
};

export function createLedger(): LedgerState {
  return {
    positions: new Map(),
    cash: ZERO,
    flows: {
      deposits: ZERO,
      withdrawals: ZERO,
      interest: ZERO,
      fees: ZERO,
      taxes: ZERO,
    },
    issues: [],
  };
}

/**
 * Aplica UNA transacción al libro mayor. Es el paso del reducer que también usará la
 * serie histórica diaria (Fase 5). Las transacciones deben llegar en orden cronológico.
 * Una transacción inválida no se aplica (ni a la posición ni al efectivo) y deja un issue.
 */
export function applyTransaction(
  state: LedgerState,
  tx: Transaction,
  options: EngineOptions = {},
): LedgerState {
  const opts: ResolvedOptions = { ...DEFAULT_OPTIONS, ...definedOnly(options) };

  const invalid = validateTransaction(tx, opts);
  if (invalid) return withIssue(state, invalid);

  switch (tx.type) {
    case "BUY": {
      const next = applyBuy(positionOf(state, tx.symbol), tx);
      return {
        ...state,
        positions: withPosition(state.positions, tx.symbol, next),
        cash: state.cash.plus(cashDelta(tx)),
      };
    }
    case "SELL": {
      const outcome = applySell(positionOf(state, tx.symbol), tx);
      if (!outcome.ok) {
        return withIssue(state, {
          severity: "error",
          code: "SELL_EXCEEDS_HOLDINGS",
          txId: tx.id,
          symbol: tx.symbol,
          requested: outcome.requested,
          available: outcome.available,
        });
      }
      return {
        ...state,
        positions: withPosition(state.positions, tx.symbol, outcome.state),
        cash: state.cash.plus(cashDelta(tx)),
      };
    }
    case "DIVIDEND": {
      const next = applyDividend(positionOf(state, tx.symbol), tx.amount);
      return {
        ...state,
        positions: withPosition(state.positions, tx.symbol, next),
        cash: state.cash.plus(cashDelta(tx)),
      };
    }
    case "SPLIT": {
      const current = state.positions.get(tx.symbol);
      if (!current || current.quantity.isZero()) {
        return withIssue(state, {
          severity: "warning",
          code: "SPLIT_WITHOUT_POSITION",
          txId: tx.id,
          symbol: tx.symbol,
        });
      }
      return {
        ...state,
        positions: withPosition(
          state.positions,
          tx.symbol,
          applySplit(current, tx.splitRatio),
        ),
      };
    }
    case "DEPOSIT":
      return cashMovement(state, tx, {
        deposits: state.flows.deposits.plus(tx.amount),
      });
    case "WITHDRAWAL":
      return cashMovement(state, tx, {
        withdrawals: state.flows.withdrawals.plus(tx.amount),
      });
    case "INTEREST":
      return cashMovement(state, tx, {
        interest: state.flows.interest.plus(tx.amount),
      });
    case "FEE":
      return cashMovement(state, tx, {
        fees: state.flows.fees.plus(tx.amount),
      });
    case "TAX":
      return cashMovement(state, tx, {
        taxes: state.flows.taxes.plus(tx.amount),
      });
  }
}

/** Cierra el recorrido: ordena las posiciones, suma totales y evalúa el saldo final. */
export function finalizeLedger(state: LedgerState): EngineResult {
  const positions = [...state.positions.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([symbol, p]) => toPosition(symbol, p));

  const totals: EngineTotals = {
    openCostBasis: sum(positions.map((p) => p.costBasis)),
    realizedPnl: sum(positions.map((p) => p.realizedPnl)),
    dividends: sum(positions.map((p) => p.dividends)),
    ...state.flows,
  };

  // Solo el saldo final: una compra puede registrarse minutos antes del depósito que la
  // fondea (pasa en los exports de Delta), así que un negativo transitorio no es un error.
  const issues: EngineIssue[] = [...state.issues];
  if (state.cash.lt(0)) {
    issues.push({
      severity: "warning",
      code: "NEGATIVE_CASH",
      cash: state.cash,
    });
  }

  return { positions, cash: state.cash, totals, issues };
}

/**
 * Motor de cálculo puro (spec §6): transacciones de UNA cuenta -> posiciones, efectivo,
 * totales e issues. Ordena cronológicamente, no muta la entrada y no lanza por datos
 * malos: los reporta en `issues`. Lanza solo por mal uso (varias cuentas a la vez).
 */
export function computeEngine(
  txs: readonly Transaction[],
  options: EngineOptions = {},
): EngineResult {
  assertSingleAccount(txs);
  let state = createLedger();
  for (const tx of sortTransactions(txs)) {
    state = applyTransaction(state, tx, options);
  }
  return finalizeLedger(state);
}

function assertSingleAccount(txs: readonly Transaction[]): void {
  const first = txs[0]?.accountId;
  if (txs.some((tx) => tx.accountId !== first)) {
    // El costo promedio es por cuenta: mezclar cuentas daría un realizado incorrecto.
    throw new Error("computeEngine recibe transacciones de una sola cuenta");
  }
}

function validateTransaction(
  tx: Transaction,
  opts: ResolvedOptions,
): EngineIssue | null {
  const invalid = (message: string): EngineIssue => ({
    severity: "error",
    code: "INVALID_TRANSACTION",
    txId: tx.id,
    message,
  });

  if (tx.currency !== opts.currency) {
    return {
      severity: "error",
      code: "UNSUPPORTED_CURRENCY",
      txId: tx.id,
      message: `Moneda ${tx.currency} no soportada (solo ${opts.currency})`,
    };
  }
  if (
    Number.isNaN(tx.executedAt.getTime()) ||
    Number.isNaN(tx.createdAt.getTime())
  ) {
    return invalid("Fecha inválida");
  }

  switch (tx.type) {
    case "BUY":
    case "SELL":
      if (!tx.symbol) return invalid("Falta el símbolo");
      if (!isPositive(tx.quantity))
        return invalid("La cantidad debe ser mayor que 0");
      if (!isNonNegative(tx.price))
        return invalid("El precio no puede ser negativo");
      if (!isNonNegative(tx.fee))
        return invalid("La comisión no puede ser negativa");
      return null;
    case "DIVIDEND":
      if (!tx.symbol) return invalid("Falta el símbolo");
      if (!isPositive(tx.amount))
        return invalid("El monto debe ser mayor que 0");
      return null;
    case "SPLIT":
      if (!tx.symbol) return invalid("Falta el símbolo");
      if (!isPositive(tx.splitRatio))
        return invalid("La razón del split debe ser mayor que 0");
      return null;
    case "DEPOSIT":
    case "WITHDRAWAL":
    case "FEE":
    case "TAX":
      return isPositive(tx.amount)
        ? null
        : invalid("El monto debe ser mayor que 0");
    case "INTEREST":
      // Puede ser negativo: el interés de margen se cobra.
      return tx.amount.isFinite()
        ? null
        : invalid("El monto no es un número válido");
  }
}

const isPositive = (x: Dec): boolean => x.isFinite() && x.gt(0);
const isNonNegative = (x: Dec): boolean => x.isFinite() && x.gte(0);

function cashMovement(
  state: LedgerState,
  tx: Transaction,
  flows: Partial<CashFlows>,
): LedgerState {
  return {
    ...state,
    cash: state.cash.plus(cashDelta(tx)),
    flows: { ...state.flows, ...flows },
  };
}

function positionOf(state: LedgerState, symbol: string): PositionState {
  return state.positions.get(symbol) ?? emptyPosition;
}

function withPosition(
  positions: ReadonlyMap<string, PositionState>,
  symbol: string,
  next: PositionState,
): ReadonlyMap<string, PositionState> {
  const copy = new Map(positions);
  copy.set(symbol, next);
  return copy;
}

function withIssue(state: LedgerState, issue: EngineIssue): LedgerState {
  return { ...state, issues: [...state.issues, issue] };
}

function sum(values: readonly Dec[]): Dec {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

// `{ currency: undefined }` no debe pisar el valor por defecto al hacer el spread.
function definedOnly(options: EngineOptions): Partial<ResolvedOptions> {
  const out: Partial<ResolvedOptions> = {};
  if (options.costMethod !== undefined) out.costMethod = options.costMethod;
  if (options.currency !== undefined) out.currency = options.currency;
  return out;
}
