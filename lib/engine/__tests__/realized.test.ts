import { describe, expect, it } from "vitest";
import { ZERO } from "../decimal";
import { computeEngine } from "../engine";
import { realizedEvents, summarizeRealized } from "../realized";
import { buy, deepFreeze, deposit, expectDec, sell, split } from "./helpers";

// Setiembre de 2026; las 15:00Z son las 11:00 en Nueva York: cada operación cae en su día.
const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T15:00:00Z`;

describe("realizedEvents", () => {
  it("una venta parcial realiza contra el costo promedio, con la comisión", () => {
    const events = realizedEvents([
      deposit(at(1), "10000"),
      buy(at(1), "AAPL", "10", "100", "5"), // costo 1005 → 100,5 por acción
      buy(at(2), "AAPL", "10", "110", "5"), // costo 2110 → 105,5 por acción
      sell(at(10), "AAPL", "5", "120", "2"), // 598 − 527,5
    ]);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.date).toBe("2026-09-10");
    expect(event?.symbol).toBe("AAPL");
    expectDec(event!.proceeds, "598");
    expectDec(event!.costOut, "527.5");
    expectDec(event!.realized, "70.5");
  });

  it("la suma de los eventos es el realizado acumulado del motor", () => {
    const txs = [
      deposit(at(1), "10000"),
      buy(at(1), "AAPL", "3", "100"),
      buy(at(2), "MSFT", "7", "50", "1"),
      sell(at(3), "AAPL", "1", "90"),
      buy(at(4), "AAPL", "2", "120"),
      sell(at(8), "AAPL", "4", "130", "3"), // cierra la posición
      sell(at(9), "MSFT", "7", "40"),
    ];
    const events = realizedEvents(txs);
    expect(events).toHaveLength(3);
    const total = events.reduce((acc, e) => acc.plus(e.realized), ZERO);
    expectDec(total, computeEngine(txs).totals.realizedPnl.toFixed());
  });

  it("un split no realiza nada y la venta posterior usa el costo de antes", () => {
    const events = realizedEvents([
      deposit(at(1), "10000"),
      buy(at(1), "NVDA", "10", "1000"),
      split(at(5), "NVDA", "10"), // 100 acciones a costo 100
      sell(at(10), "NVDA", "50", "120"),
    ]);
    expect(events).toHaveLength(1);
    expectDec(events[0]!.costOut, "5000");
    expectDec(events[0]!.realized, "1000");
  });

  it("una venta que excede la tenencia no genera evento", () => {
    const events = realizedEvents([
      deposit(at(1), "1000"),
      buy(at(1), "AAPL", "1", "100"),
      sell(at(2), "AAPL", "2", "100"),
    ]);
    expect(events).toEqual([]);
  });

  it("ordena por fecha aunque lleguen desordenadas y no muta la entrada", () => {
    const txs = deepFreeze([
      sell(at(10), "AAPL", "1", "150"),
      deposit(at(1), "1000"),
      buy(at(1), "AAPL", "2", "100"),
    ]);
    const events = realizedEvents(txs);
    expect(events.map((e) => e.date)).toEqual(["2026-09-10"]);
    expectDec(events[0]!.realized, "50");
  });

  it("la fecha es el día de mercado de Nueva York", () => {
    // 01:00Z del 11 son las 21:00 del 10 en Nueva York.
    const events = realizedEvents([
      deposit(at(1), "1000"),
      buy(at(1), "AAPL", "1", "100"),
      sell("2026-09-11T01:00:00Z", "AAPL", "1", "110"),
    ]);
    expect(events[0]?.date).toBe("2026-09-10");
  });
});

describe("summarizeRealized", () => {
  const events = realizedEvents([
    deposit(at(1), "100000"),
    buy(at(1), "AAPL", "10", "100"),
    buy(at(1), "MSFT", "10", "100"),
    buy(at(1), "TSLA", "10", "100"),
    sell(at(3), "AAPL", "1", "150"), // +50
    sell(at(15), "AAPL", "1", "120"), // +20
    sell(at(16), "MSFT", "2", "80"), // −40
    sell(at(30), "TSLA", "1", "130"), // +30
  ]);

  it("filtra por rango inclusive en ambos extremos", () => {
    const summary = summarizeRealized(events, "2026-09-15", "2026-09-30");
    expect(summary.bySymbol.map((r) => r.symbol)).toEqual([
      "TSLA",
      "AAPL",
      "MSFT",
    ]);
    expectDec(summary.total, "10");
    expect(summary.sales).toBe(3);
  });

  it("sin límites suma todo y agrupa por símbolo", () => {
    const summary = summarizeRealized(events, null, null);
    const aapl = summary.bySymbol.find((r) => r.symbol === "AAPL");
    expectDec(aapl!.realized, "70");
    expect(aapl!.sales).toBe(2);
    expectDec(summary.total, "60");
  });

  it("un rango sin ventas da total 0 y ninguna fila", () => {
    const summary = summarizeRealized(events, "2026-09-04", "2026-09-14");
    expect(summary.bySymbol).toEqual([]);
    expectDec(summary.total, "0");
    expect(summary.sales).toBe(0);
  });
});
