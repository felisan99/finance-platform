import { describe, expect, it } from "vitest";
import { computeEngine, d, valuePortfolio, type PriceInfo } from "@/lib/engine";
import { buy, deposit, sell } from "@/lib/engine/__tests__/helpers";
import type { InstrumentRow, WatchlistMarketRow } from "../rows";
import { TREND_ROWS, buildTrendRows, pickTrendPositions } from "../trend-view";

const T = "2026-01-05T15:00:00Z";

const price = (value: string, previous: string | null): PriceInfo => ({
  price: d(value),
  asOf: new Date("2026-09-23T20:00:00Z"),
  source: "quote",
  previousClose: previous === null ? null : d(previous),
});

const instrument = (symbol: string, name: string | null): InstrumentRow =>
  ({ id: `id-${symbol}`, symbol, name }) as InstrumentRow;

const market = (
  symbol: string,
  closes: string[] | null,
): WatchlistMarketRow => ({
  instrument_id: `id-${symbol}`,
  last_close: "1",
  last_date: "2026-09-23",
  prev_close: null,
  prev_date: null,
  low_close: null,
  high_close: null,
  recent:
    closes === null ? null : closes.map((c, i) => [`2026-09-${10 + i}`, c]),
});

describe("pickTrendPositions", () => {
  it(`las ${TREND_ROWS} abiertas de mayor valor, sin cerradas ni sin precio`, () => {
    const symbols = ["A", "B", "C", "D", "E", "F", "G"];
    const txs = [
      deposit(T, "100000"),
      ...symbols.map((s) => buy(T, s, "1", "10")),
      buy(T, "NOPRICE", "1", "10"),
      buy(T, "OLD", "1", "10"),
      sell("2026-02-05T15:00:00Z", "OLD", "1", "12"),
    ];
    // Valores 100, 90, 80, 70, 60, 50, 40 para A…G. OLD es cerrada y NOPRICE no tiene precio.
    const prices = new Map(
      symbols.map((s, i) => [s, price(String(100 - i * 10), "50")] as const),
    );
    const valued = valuePortfolio(computeEngine(txs), prices);
    expect(pickTrendPositions(valued).map((p) => p.symbol)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });

  it("los empates de valor se ordenan por símbolo", () => {
    const txs = [
      deposit(T, "1000"),
      buy(T, "ZZZ", "1", "10"),
      buy(T, "AAA", "1", "10"),
    ];
    const valued = valuePortfolio(
      computeEngine(txs),
      new Map([
        ["ZZZ", price("20", "20")],
        ["AAA", price("20", "20")],
      ]),
    );
    expect(pickTrendPositions(valued).map((p) => p.symbol)).toEqual([
      "AAA",
      "ZZZ",
    ]);
  });
});

describe("buildTrendRows", () => {
  const txs = [
    deposit(T, "10000"),
    buy(T, "VOO", "2", "100"), // costo 200
    buy(T, "NEW", "1", "50"),
  ];
  const valued = valuePortfolio(
    computeEngine(txs),
    new Map([
      ["VOO", price("110", "100")], // +10 % en el día y sobre el costo
      ["NEW", price("50", "50")],
    ]),
  );
  const rows = buildTrendRows(
    pickTrendPositions(valued),
    new Map([
      ["VOO", instrument("VOO", "Vanguard S&P 500 ETF")],
      ["NEW", instrument("NEW", null)],
    ]),
    new Map([
      ["id-VOO", market("VOO", ["100", "104", "110"])],
      // Un solo cierre: no hay línea que dibujar.
      ["id-NEW", market("NEW", ["50"])],
    ]),
  );

  it("nombre, enlace, cambio del día y ganancia sobre el costo", () => {
    const voo = rows.find((r) => r.symbol === "VOO")!;
    expect(voo.name).toBe("Vanguard S&P 500 ETF");
    expect(voo.href).toBe("/positions/VOO");
    expect(voo.dayChangePct!.toFixed()).toBe("0.1");
    expect(voo.unrealizedPct!.toFixed()).toBe("0.1");
  });

  it("el minigráfico usa los cierres en orden; con menos de dos no hay línea", () => {
    expect(rows.find((r) => r.symbol === "VOO")!.spark).toEqual([
      100, 104, 110,
    ]);
    expect(rows.find((r) => r.symbol === "NEW")!.spark).toEqual([]);
  });

  it("con la cotización de un día posterior al último cierre, el minigráfico termina en ella", () => {
    const live = valuePortfolio(
      computeEngine([deposit(T, "10000"), buy(T, "VOO", "2", "100")]),
      new Map([
        [
          "VOO",
          {
            ...price("112", "110"),
            asOf: new Date("2026-09-24T17:30:00Z"),
          },
        ],
      ]),
    );
    const [row] = buildTrendRows(
      pickTrendPositions(live),
      new Map([["VOO", instrument("VOO", "Vanguard")]]),
      new Map([["id-VOO", market("VOO", ["100", "104", "110"])]]),
    );
    expect(row!.spark).toEqual([100, 104, 110, 112]);
  });

  it("sin fila de mercado (o sin historial) el minigráfico queda vacío y la fila se muestra igual", () => {
    const withoutMarket = buildTrendRows(
      pickTrendPositions(valued),
      new Map([["VOO", instrument("VOO", "Vanguard")]]),
      new Map(),
    );
    expect(withoutMarket.map((r) => r.spark)).toEqual([[], []]);
    expect(withoutMarket.find((r) => r.symbol === "NEW")!.name).toBeNull();
    const nullRecent = buildTrendRows(
      pickTrendPositions(valued),
      new Map([["VOO", instrument("VOO", "Vanguard")]]),
      new Map([["id-VOO", market("VOO", null)]]),
    );
    expect(nullRecent.find((r) => r.symbol === "VOO")!.spark).toEqual([]);
  });

  it("un símbolo con caracteres especiales se codifica en el enlace", () => {
    const valuedSpecial = valuePortfolio(
      computeEngine([deposit(T, "1000"), buy(T, "BRK.B", "1", "10")]),
      new Map([["BRK.B", price("10", "10")]]),
    );
    const [row] = buildTrendRows(
      pickTrendPositions(valuedSpecial),
      new Map(),
      new Map(),
    );
    expect(row!.href).toBe("/positions/BRK.B");
  });
});
