import { expect } from "vitest";
import { d, type Dec } from "../decimal";
import type {
  CashTx,
  DividendTx,
  EngineResult,
  Position,
  SplitTx,
  TradeTx,
} from "../types";

export const ACCOUNT = "acc-1";

let counter = 0;
const nextId = () => `t${++counter}`;
const at = (iso: string) => new Date(iso);

export function buy(
  iso: string,
  symbol: string,
  quantity: string,
  price: string,
  fee = "0",
): TradeTx {
  return trade("BUY", iso, symbol, quantity, price, fee);
}

export function sell(
  iso: string,
  symbol: string,
  quantity: string,
  price: string,
  fee = "0",
): TradeTx {
  return trade("SELL", iso, symbol, quantity, price, fee);
}

function trade(
  type: "BUY" | "SELL",
  iso: string,
  symbol: string,
  quantity: string,
  price: string,
  fee: string,
): TradeTx {
  return {
    id: nextId(),
    accountId: ACCOUNT,
    type,
    symbol,
    executedAt: at(iso),
    createdAt: at(iso),
    currency: "USD",
    quantity: d(quantity),
    price: d(price),
    fee: d(fee),
  };
}

export function cashTx(
  type: CashTx["type"],
  iso: string,
  amount: string,
  symbol: string | null = null,
): CashTx {
  return {
    id: nextId(),
    accountId: ACCOUNT,
    type,
    symbol,
    executedAt: at(iso),
    createdAt: at(iso),
    currency: "USD",
    amount: d(amount),
  };
}

export const deposit = (iso: string, amount: string) =>
  cashTx("DEPOSIT", iso, amount);
export const withdrawal = (iso: string, amount: string) =>
  cashTx("WITHDRAWAL", iso, amount);

export function dividend(
  iso: string,
  symbol: string,
  amount: string,
): DividendTx {
  return {
    id: nextId(),
    accountId: ACCOUNT,
    type: "DIVIDEND",
    symbol,
    executedAt: at(iso),
    createdAt: at(iso),
    currency: "USD",
    amount: d(amount),
  };
}

export function split(iso: string, symbol: string, ratio: string): SplitTx {
  return {
    id: nextId(),
    accountId: ACCOUNT,
    type: "SPLIT",
    symbol,
    executedAt: at(iso),
    createdAt: at(iso),
    currency: "USD",
    splitRatio: d(ratio),
  };
}

/** Igualdad exacta de decimales, con un mensaje de fallo legible. */
export function expectDec(actual: Dec, expected: string): void {
  expect(actual.toFixed()).toBe(d(expected).toFixed());
}

export function positionOf(result: EngineResult, symbol: string): Position {
  const position = result.positions.find((p) => p.symbol === symbol);
  if (!position) throw new Error(`No hay posición para ${symbol}`);
  return position;
}

/** Representación plana y comparable de un resultado (los Decimal como strings canónicos). */
export function snapshot(result: EngineResult) {
  return {
    cash: result.cash.toFixed(),
    positions: result.positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity.toFixed(),
      costBasis: p.costBasis.toFixed(),
      realizedPnl: p.realizedPnl.toFixed(),
      dividends: p.dividends.toFixed(),
      isOpen: p.isOpen,
    })),
    totals: Object.fromEntries(
      Object.entries(result.totals).map(([key, value]) => [
        key,
        value.toFixed(),
      ]),
    ),
    issues: result.issues.map((issue) => `${issue.severity}:${issue.code}`),
  };
}

/** Congela recursivamente objetos y arreglos (los Date no se pueden congelar de verdad). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
