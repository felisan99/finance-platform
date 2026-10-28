import { describe, expect, it } from "vitest";
import { d, ZERO, type Dec } from "../decimal";
import { computeEngine } from "../engine";
import { simulateTrades, type SimResult } from "../trade-sim";
import { valuePortfolio, type PriceInfo } from "../valuation";
import { buy, deposit, expectDec } from "./helpers";

const at = "2026-09-21T15:00:00Z";
const priced = (price: string): PriceInfo => ({
  price: d(price),
  asOf: new Date(at),
  source: "close",
  previousClose: null,
});

// Cartera: 10 VOO a 100 (costo 80) + 5 NVDA a 200 (costo 100) + 1000 de efectivo = 3000.
const valued = valuePortfolio(
  computeEngine([
    deposit(at, "2400"),
    buy(at, "VOO", "10", "80"),
    buy(at, "NVDA", "5", "100"),
    buy(at, "XNEW", "1", "100"),
  ]),
  new Map([
    ["VOO", priced("100")],
    ["NVDA", priced("200")],
  ]),
);

function ok(result: SimResult) {
  if (!result.ok) throw new Error(result.error);
  return result;
}
const weightOf = (
  result: ReturnType<typeof ok>,
  symbol: string,
  which: "before" | "after",
): Dec | null =>
  result[which].holdings.find((h) => h.symbol === symbol)?.weight ?? null;

describe("simulateTrades", () => {
  it("el estado de partida coincide con la valuación de hoy", () => {
    const result = ok(
      simulateTrades({
        valued,
        trades: [{ symbol: "VOO", side: "SELL", quantity: d("0.000001") }],
        prices: new Map(),
        funding: "cash",
      }),
    );
    expectDec(result.before.totalValue, valued.totalValue.toFixed());
    for (const position of valued.positions.filter((p) => p.weight !== null)) {
      expectDec(
        weightOf(result, position.symbol, "before")!,
        position.weight!.toFixed(),
      );
    }
    expect(result.unpriced).toEqual(["XNEW"]);
  });

  it("vender la mitad pasa el valor a efectivo y estima la ganancia con el costo promedio", () => {
    const result = ok(
      simulateTrades({
        valued,
        trades: [{ symbol: "NVDA", side: "SELL", fraction: d("0.5") }],
        prices: new Map(),
        funding: "cash",
      }),
    );
    const [trade] = result.trades;
    expectDec(trade!.quantity, "2.5");
    expectDec(trade!.amount, "500");
    expectDec(trade!.realizedGain!, "250"); // 2,5 × (200 − 100)
    expectDec(result.after.totalValue, "3000");
    expectDec(result.after.cash, "1500");
    expectDec(
      weightOf(result, "NVDA", "after")!,
      "0.1666666666666666666666666666666666666667",
    );
    expectDec(result.after.cashWeight!, "0.5");
  });

  it("vender todo saca la posición", () => {
    const result = ok(
      simulateTrades({
        valued,
        trades: [{ symbol: "VOO", side: "SELL", fraction: d("1") }],
        prices: new Map(),
        funding: "cash",
      }),
    );
    expect(result.after.holdings.map((h) => h.symbol)).toEqual(["NVDA"]);
  });

  it("comprar con plata nueva sube el total; con efectivo, no", () => {
    const fresh = ok(
      simulateTrades({
        valued,
        trades: [{ symbol: "BTC-USD", side: "BUY", amount: d("1000") }],
        prices: new Map([["BTC-USD", d("100000")]]),
        funding: "new_money",
      }),
    );
    expectDec(fresh.after.totalValue, "4000");
    expectDec(fresh.newMoney, "1000");
    expectDec(fresh.trades[0]!.quantity, "0.01");
    expectDec(weightOf(fresh, "BTC-USD", "after")!, "0.25");

    const cash = ok(
      simulateTrades({
        valued,
        trades: [{ symbol: "VOO", side: "BUY", quantity: d("5") }],
        prices: new Map(),
        funding: "cash",
      }),
    );
    expectDec(cash.after.totalValue, "3000");
    expectDec(cash.after.cash, "500");
    expectDec(cash.newMoney, ZERO.toFixed());
  });

  it("encadena operaciones: lo que libera una venta paga la compra siguiente", () => {
    const result = ok(
      simulateTrades({
        valued,
        trades: [
          { symbol: "NVDA", side: "SELL", quantity: d("5") },
          { symbol: "VOO", side: "BUY", amount: d("2000") },
        ],
        prices: new Map(),
        funding: "cash",
      }),
    );
    expectDec(result.after.cash, "0");
    expectDec(weightOf(result, "VOO", "after")!, "1");
  });

  it("rechaza lo imposible sin simular a medias", () => {
    const run = (
      trades: Parameters<typeof simulateTrades>[0]["trades"],
      funding: "cash" | "new_money" = "cash",
    ) => simulateTrades({ valued, trades, prices: new Map(), funding });
    expect(run([{ symbol: "NVDA", side: "SELL", quantity: d("6") }]).ok).toBe(
      false,
    );
    expect(run([{ symbol: "VOO", side: "BUY", amount: d("1001") }]).ok).toBe(
      false,
    );
    expect(run([{ symbol: "XNEW", side: "SELL", fraction: d("0.5") }]).ok).toBe(
      false,
    );
    expect(run([{ symbol: "TSLA", side: "BUY", amount: d("10") }]).ok).toBe(
      false,
    );
    expect(run([{ symbol: "VOO", side: "BUY", fraction: d("0.5") }]).ok).toBe(
      false,
    );
    expect(run([{ symbol: "VOO", side: "SELL", fraction: d("1.5") }]).ok).toBe(
      false,
    );
    expect(
      run([{ symbol: "VOO", side: "SELL", quantity: d("1"), amount: d("1") }])
        .ok,
    ).toBe(false);
    expect(run([]).ok).toBe(false);
  });
});
