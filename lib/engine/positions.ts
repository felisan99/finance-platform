import { QTY_EPSILON, ZERO, type Dec } from "./decimal";
import type { Position, TradeTx } from "./types";

/** Estado interno de un símbolo mientras se recorren las transacciones. */
export interface PositionState {
  readonly quantity: Dec;
  readonly costBasis: Dec;
  readonly realizedPnl: Dec;
  readonly dividends: Dec;
}

export const emptyPosition: PositionState = {
  quantity: ZERO,
  costBasis: ZERO,
  realizedPnl: ZERO,
  dividends: ZERO,
};

// Método de costo promedio (spec §6.1). Todas las funciones son puras: devuelven un
// estado nuevo y nunca modifican el recibido.

export function applyBuy(p: PositionState, tx: TradeTx): PositionState {
  return {
    ...p,
    quantity: p.quantity.plus(tx.quantity),
    costBasis: p.costBasis.plus(tx.quantity.mul(tx.price)).plus(tx.fee),
  };
}

export type SellOutcome =
  | { ok: true; state: PositionState }
  | { ok: false; requested: Dec; available: Dec };

export function applySell(p: PositionState, tx: TradeTx): SellOutcome {
  const q = tx.quantity;
  // Short no soportado: vender más de lo que hay (con la tolerancia de §6.7) es un error.
  if (q.gt(p.quantity.plus(QTY_EPSILON))) {
    return { ok: false, requested: q, available: p.quantity };
  }

  const proceeds = q.mul(tx.price).minus(tx.fee);
  // Vender todo (o todo salvo polvo < ε) consume el costo base exacto: así la división
  // costBasis·q/qty nunca deja un residuo y la posición cierra en 0 exacto.
  const closes = p.quantity.minus(q).lt(QTY_EPSILON);
  const costOut = closes ? p.costBasis : p.costBasis.mul(q).div(p.quantity);

  return {
    ok: true,
    state: {
      quantity: closes ? ZERO : p.quantity.minus(q),
      costBasis: closes ? ZERO : p.costBasis.minus(costOut),
      realizedPnl: p.realizedPnl.plus(proceeds).minus(costOut),
      dividends: p.dividends,
    },
  };
}

/** El costo base no cambia: el costo promedio se ajusta solo al cambiar la cantidad. */
export function applySplit(p: PositionState, ratio: Dec): PositionState {
  return { ...p, quantity: p.quantity.mul(ratio) };
}

export function applyDividend(p: PositionState, amount: Dec): PositionState {
  return { ...p, dividends: p.dividends.plus(amount) };
}

export function toPosition(symbol: string, p: PositionState): Position {
  const isOpen = !p.quantity.isZero();
  return {
    symbol,
    quantity: p.quantity,
    costBasis: p.costBasis,
    avgCost: isOpen ? p.costBasis.div(p.quantity) : null,
    realizedPnl: p.realizedPnl,
    dividends: p.dividends,
    isOpen,
  };
}
