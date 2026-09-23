import { ZERO, type Dec } from "./decimal";
import type { Transaction } from "./types";

/**
 * Efecto de una transacción sobre el efectivo de la cuenta (spec §6.2).
 * Es el único lugar donde vive la fórmula del efectivo.
 */
export function cashDelta(tx: Transaction): Dec {
  switch (tx.type) {
    case "DEPOSIT":
    case "DIVIDEND":
    case "INTEREST":
      return tx.amount;
    case "WITHDRAWAL":
    case "FEE":
    case "TAX":
      return tx.amount.neg();
    case "BUY":
      return tx.quantity.mul(tx.price).plus(tx.fee).neg();
    case "SELL":
      return tx.quantity.mul(tx.price).minus(tx.fee);
    case "SPLIT":
      return ZERO;
  }
}

/** Σ cashDelta sin validar nada; el efectivo validado sale de `computeEngine`. */
export function computeCash(txs: readonly Transaction[]): Dec {
  return txs.reduce((cash, tx) => cash.plus(cashDelta(tx)), ZERO);
}
