import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ZERO,
  addMonths,
  buildDailySeries,
  computeEngine,
  computePerformance,
  d,
  onOrBeforeWeekday,
  valuePortfolio,
  weekdaysBetween,
  type DailyClose,
  type PriceInfo,
  type Transaction,
} from "@/lib/engine";
import { parseDeltaCsv, toEngineTransactions } from "@/lib/importers";
import { ACCOUNT, buy, deposit } from "./helpers";

// La serie histórica y la valuación de hoy (`valuePortfolio`) son dos caminos distintos al mismo
// número: si el último punto de la serie no coincide con el valor total, alguno de los dos está
// mal. Con el CSV de Delta del fixture (precios inventados y deterministas) y con trayectorias aleatorias.

const csv = readFileSync(
  new URL("../__fixtures__/delta_export.csv", import.meta.url),
  "utf8",
);
const transactions = toEngineTransactions(parseDeltaCsv(csv).transactions, {
  accountId: ACCOUNT,
  importedAt: new Date("2026-09-23T12:00:00Z"),
});

describe("el CSV de Delta del fixture con precios inventados", () => {
  const END = "2026-09-30";
  const symbols = [
    ...new Set(
      transactions.flatMap((tx) =>
        "symbol" in tx && tx.symbol ? [tx.symbol] : [],
      ),
    ),
  ].sort();
  const days = weekdaysBetween("2026-02-23", END);
  const closes = new Map<string, DailyClose[]>(
    symbols.map((symbol, s) => [
      symbol,
      days.map((date, i) => ({
        date,
        close: d(
          (40 + s * 10 + ((i * 7 + s * 13) % 23) + (i % 4) * 0.25).toFixed(2),
        ),
      })),
    ]),
  );

  const series = buildDailySeries({ transactions, closes, endDate: END });
  const engine = computeEngine(transactions);
  const last = series.points.at(-1)!;

  it("hay precios para todos los símbolos y la serie arranca el día de la primera operación", () => {
    expect(symbols.length).toBeGreaterThan(5);
    expect(series.points[0]!.date).toBe("2026-03-06");
    expect(last.date).toBe(END);
    expect(series.unpricedSymbols).toEqual([]);
  });

  it("el último punto coincide con valuePortfolio: valor total, efectivo y valor de mercado", () => {
    const prices = new Map<string, PriceInfo>();
    for (const position of engine.positions) {
      if (!position.isOpen) continue;
      const close = closes.get(position.symbol)!.at(-1)!;
      prices.set(position.symbol, {
        price: close.close,
        asOf: new Date(`${close.date}T21:00:00Z`),
        source: "close",
        previousClose: null,
      });
    }
    const valued = valuePortfolio(engine, prices);
    expect(last.value.eq(valued.totalValue)).toBe(true);
    expect(last.marketValue.eq(valued.marketValue)).toBe(true);
    expect(last.cash.eq(engine.cash)).toBe(true);
    expect(last.cash.toFixed()).toBe("882.745"); // spec §8.3
  });

  it("Σ de flujos diarios = depósitos − retiros del motor", () => {
    const total = series.points.reduce((acc, p) => acc.plus(p.flow), ZERO);
    expect(
      total.eq(engine.totals.deposits.minus(engine.totals.withdrawals)),
    ).toBe(true);
  });

  it("todos los valores son finitos y la serie no deja huecos de días hábiles", () => {
    expect(series.points.map((p) => p.date)).toEqual(
      weekdaysBetween("2026-03-06", END),
    );
    for (const point of series.points)
      expect(point.value.isFinite()).toBe(true);
  });

  it("computePerformance corre sobre el historial del fixture y da un TWR y un XIRR de Todo", () => {
    const result = computePerformance({
      transactions,
      closes,
      benchmark: closes.get(symbols[0]!)!,
      endDate: END,
    });
    const max = result.periods.find((p) => p.id === "MAX")!;
    expect(max.twr).not.toBeNull();
    expect(max.xirr).not.toBeNull();
    expect(max.benchmarkReturn).not.toBeNull();
    expect(max.startDate).toBe("2026-03-06");
  });
});

describe("propiedades sobre trayectorias aleatorias de un solo activo", () => {
  // Lunes 2026-03-02 → lunes 2027-03-01: 364 días, 261 días hábiles.
  const START = "2026-03-02";
  const END = "2027-03-01";
  const grid = weekdaysBetween(START, END);

  const scenario = fc.record({
    cents: fc.array(fc.integer({ min: 500, max: 100_000 }), {
      minLength: grid.length,
      maxLength: grid.length,
    }),
    quantity: fc.integer({ min: 1, max: 50 }),
  });

  function build(cents: readonly number[], quantity: number) {
    const price = (i: number) => (cents[i]! / 100).toFixed(2);
    const first = price(0);
    const txs: Transaction[] = [
      deposit(`${START}T15:00:00Z`, ((quantity * cents[0]!) / 100).toFixed(2)),
      buy(`${START}T15:00:00Z`, "AAA", String(quantity), first),
    ];
    const rows: DailyClose[] = grid.map((date, i) => ({
      date,
      close: d(price(i)),
    }));
    const priceOn = new Map(grid.map((date, i) => [date, cents[i]! / 100]));
    const result = computePerformance({
      transactions: txs,
      closes: new Map([["AAA", rows]]),
      benchmark: null,
      endDate: END,
    });
    return { result, priceOn };
  }

  it("sin flujos posteriores: TWR = P_final / P_inicial − 1 y XIRR = (P_final / P_inicial)^(365/364) − 1", () => {
    fc.assert(
      fc.property(scenario, ({ cents, quantity }) => {
        const { result, priceOn } = build(cents, quantity);
        const max = result.periods.find((p) => p.id === "MAX")!;
        const ratio = priceOn.get(END)! / priceOn.get(START)!;

        const twrOk = Math.abs(max.twr!.toNumber() - (ratio - 1)) < 1e-9;
        const expectedXirr = Math.pow(ratio, 365 / 364) - 1;
        if (!(expectedXirr > -0.99999 && expectedXirr < 1e6)) return twrOk;
        return (
          twrOk &&
          max.xirr !== null &&
          Math.abs(max.xirr.toNumber() - expectedXirr) <=
            1e-8 * Math.max(1, Math.abs(expectedXirr))
        );
      }),
      { numRuns: 60 },
    );
  });

  it("el TWR de cada período es P_final / P_base − 1, con la base elegida por calendario", () => {
    fc.assert(
      fc.property(scenario, ({ cents, quantity }) => {
        const { result, priceOn } = build(cents, quantity);
        return (["1S", "1M", "3M", "YTD", "1A"] as const).every((id) => {
          const period = result.periods.find((p) => p.id === id)!;
          // La base es un día hábil de la serie y su cierre es el punto de partida. Si es el día
          // previo al historial (todavía sin portafolio), el retorno arranca del primer día, que se
          // compró a su cierre.
          const basePrice = priceOn.get(period.baseDate) ?? priceOn.get(START)!;
          const expected = priceOn.get(END)! / basePrice - 1;
          return Math.abs(period.twr!.toNumber() - expected) < 1e-9;
        });
      }),
      { numRuns: 60 },
    );
  });

  it("las bases de período siguen el calendario (1M = un mes calendario antes, en día hábil)", () => {
    const { result } = build(
      grid.map(() => 1000),
      1,
    );
    expect(result.periods.find((p) => p.id === "1M")!.baseDate).toBe(
      onOrBeforeWeekday(addMonths(END, -1)),
    );
  });
});
