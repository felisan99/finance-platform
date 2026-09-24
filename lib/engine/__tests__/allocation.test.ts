import { describe, expect, it } from "vitest";
import { computeAllocation, type AllocationSlice } from "../allocation";
import { d, ZERO, type Dec } from "../decimal";
import { computeEngine } from "../engine";
import { valuePortfolio, type PriceInfo } from "../valuation";
import { buy, deepFreeze, deposit, sell } from "./helpers";

const T0 = "2026-01-05T15:00:00Z";
const T1 = "2026-01-06T15:00:00Z";
const T2 = "2026-01-07T15:00:00Z";
const T3 = "2026-01-08T15:00:00Z";

const quote = (value: string): PriceInfo => ({
  price: d(value),
  asOf: new Date("2026-09-23T20:00:00Z"),
  source: "quote",
  previousClose: null,
});

function near(actual: Dec, expected: string, dp = 10): void {
  expect(actual.toDecimalPlaces(dp).toFixed()).toBe(
    d(expected).toDecimalPlaces(dp).toFixed(),
  );
}

const summary = (slices: readonly AllocationSlice[]) =>
  slices.map((s) => [s.kind, s.key, s.value.toFixed()]);

const bySymbol = (symbol: string) => symbol;

describe("computeAllocation: por posición, con efectivo", () => {
  // 3000 depositados; VOO 10 a 100 (1000) y AAA 5 a 50 (250) => efectivo 1750.
  const result = computeEngine([
    deposit(T0, "3000"),
    buy(T1, "VOO", "10", "100"),
    buy(T1, "AAA", "5", "50"),
  ]);
  const valued = valuePortfolio(
    result,
    new Map([
      ["VOO", quote("120")], // 1200
      ["AAA", quote("60")], // 300
    ]),
  );
  const allocation = computeAllocation(valued, bySymbol);

  it("una porción por posición y una para el efectivo, de mayor a menor", () => {
    expect(summary(allocation.slices)).toEqual([
      ["cash", "", "1750"],
      ["group", "VOO", "1200"],
      ["group", "AAA", "300"],
    ]);
  });

  it("los pesos son fracciones del total (1200 + 300 + 1750 = 3250)", () => {
    expect(allocation.total.toFixed()).toBe("3250");
    near(allocation.slices[0]!.weight, "0.5384615385"); // 1750 / 3250
    near(allocation.slices[1]!.weight, "0.3692307692"); // 1200 / 3250
    near(allocation.slices[2]!.weight, "0.0923076923"); // 300 / 3250
  });

  it("los pesos suman 1 y el total coincide con el valor total del portafolio", () => {
    const sum = allocation.slices.reduce((acc, s) => acc.plus(s.weight), ZERO);
    expect(sum.minus(1).abs().lt("1e-30")).toBe(true);
    expect(allocation.total.eq(valued.totalValue)).toBe(true);
  });

  it("cada porción de posición lista su símbolo; el efectivo no lista ninguno", () => {
    expect(allocation.slices.map((s) => s.symbols)).toEqual([
      [],
      ["VOO"],
      ["AAA"],
    ]);
  });

  it("no toca sus entradas", () => {
    const frozen = deepFreeze(valued);
    expect(() => computeAllocation(frozen, bySymbol)).not.toThrow();
  });
});

describe("computeAllocation: por tipo", () => {
  // VOO (ETF) 10 a 100; AAA y MSFT (acciones) 5 a 50 y 2 a 100 => efectivo 3000 − 1000 − 250 − 200 = 1550.
  const result = computeEngine([
    deposit(T0, "3000"),
    buy(T1, "VOO", "10", "100"),
    buy(T1, "AAA", "5", "50"),
    buy(T2, "MSFT", "2", "100"),
  ]);
  const valued = valuePortfolio(
    result,
    new Map([
      ["VOO", quote("120")], // 1200
      ["AAA", quote("60")], // 300
      ["MSFT", quote("110")], // 220
    ]),
  );
  const types: Record<string, string | null> = {
    VOO: "ETF",
    AAA: "STOCK",
    MSFT: "STOCK",
  };

  it("junta las posiciones del mismo tipo (300 + 220 = 520)", () => {
    const allocation = computeAllocation(valued, (s) => types[s] ?? null);
    expect(summary(allocation.slices)).toEqual([
      ["cash", "", "1550"],
      ["group", "ETF", "1200"],
      ["group", "STOCK", "520"],
    ]);
    expect(allocation.total.toFixed()).toBe("3270");
    expect(allocation.slices[2]!.symbols).toEqual(["AAA", "MSFT"]);
  });

  it("lo que no se sabe clasificar va aparte, sin mezclarse con un grupo", () => {
    const allocation = computeAllocation(valued, (s) =>
      s === "VOO" ? "ETF" : null,
    );
    expect(summary(allocation.slices)).toEqual([
      ["cash", "", "1550"],
      ["group", "ETF", "1200"],
      ["unclassified", "", "520"],
    ]);
    expect(allocation.slices[2]!.symbols).toEqual(["AAA", "MSFT"]);
  });

  it("un grupo que se llama igual que la categoría 'sin clasificar' no se mezcla", () => {
    const allocation = computeAllocation(valued, (s) =>
      s === "VOO" ? "" : null,
    );
    expect(summary(allocation.slices)).toEqual([
      ["cash", "", "1550"],
      ["group", "", "1200"],
      ["unclassified", "", "520"],
    ]);
  });
});

describe("computeAllocation: símbolos de una porción", () => {
  it("salen en orden alfabético aunque se hayan comprado al revés", () => {
    const result = computeEngine([
      deposit(T0, "1000"),
      buy(T1, "ZZZ", "1", "100"),
      buy(T2, "MMM", "1", "100"),
      buy(T3, "AAA", "1", "100"),
    ]);
    const valued = valuePortfolio(
      result,
      new Map([
        ["ZZZ", quote("100")],
        ["MMM", quote("100")],
        ["AAA", quote("100")],
      ]),
    );
    // El orden de las posiciones lo decide el motor; acá no se puede dar por hecho.
    const reversed = {
      ...valued,
      positions: [...valued.positions].sort((a, b) =>
        a.symbol < b.symbol ? 1 : -1,
      ),
    };
    expect(reversed.positions.map((p) => p.symbol)).toEqual([
      "ZZZ",
      "MMM",
      "AAA",
    ]);
    const allocation = computeAllocation(reversed, () => "STOCK");
    const stock = allocation.slices.find((s) => s.key === "STOCK")!;
    expect(stock.value.toFixed()).toBe("300");
    expect(stock.symbols).toEqual(["AAA", "MMM", "ZZZ"]);
  });
});

describe("computeAllocation: qué queda afuera", () => {
  it("una posición abierta sin precio no entra, y se avisa", () => {
    const result = computeEngine([
      deposit(T0, "2000"),
      buy(T1, "VOO", "10", "100"),
      buy(T1, "NEW", "1", "50"),
    ]);
    const valued = valuePortfolio(result, new Map([["VOO", quote("120")]]));
    const allocation = computeAllocation(valued, bySymbol);
    expect(summary(allocation.slices)).toEqual([
      ["group", "VOO", "1200"],
      ["cash", "", "950"],
    ]);
    expect(allocation.total.toFixed()).toBe("2150");
    expect(allocation.missingPrices).toEqual(["NEW"]);
  });

  it("una posición cerrada no entra: ya no tiene valor de mercado", () => {
    const result = computeEngine([
      deposit(T0, "2000"),
      buy(T1, "OLD", "10", "100"),
      sell(T2, "OLD", "10", "110"),
      buy(T3, "VOO", "5", "100"),
    ]);
    const valued = valuePortfolio(
      result,
      new Map([
        ["OLD", quote("999")],
        ["VOO", quote("100")],
      ]),
    );
    const allocation = computeAllocation(valued, bySymbol);
    // Efectivo: 2000 − 1000 + 1100 − 500 = 1600.
    expect(summary(allocation.slices)).toEqual([
      ["cash", "", "1600"],
      ["group", "VOO", "500"],
    ]);
  });

  it("el efectivo negativo no se dibuja y los pesos se reparten entre lo que sí", () => {
    // Sin depósito: comprar VOO deja el efectivo en −100.
    const result = computeEngine([buy(T1, "VOO", "1", "100")]);
    const valued = valuePortfolio(result, new Map([["VOO", quote("120")]]));
    expect(valued.cash.toFixed()).toBe("-100");
    const allocation = computeAllocation(valued, bySymbol);
    expect(summary(allocation.slices)).toEqual([["group", "VOO", "120"]]);
    expect(allocation.total.toFixed()).toBe("120");
    expect(allocation.slices[0]!.weight.toFixed()).toBe("1");
  });

  it("el efectivo en cero no aparece", () => {
    const result = computeEngine([
      deposit(T0, "1000"),
      buy(T1, "VOO", "10", "100"),
    ]);
    const valued = valuePortfolio(result, new Map([["VOO", quote("100")]]));
    const allocation = computeAllocation(valued, bySymbol);
    expect(summary(allocation.slices)).toEqual([["group", "VOO", "1000"]]);
  });

  it("un portafolio vacío no tiene porciones ni total", () => {
    const valued = valuePortfolio(computeEngine([]), new Map());
    const allocation = computeAllocation(valued, bySymbol);
    expect(allocation.slices).toEqual([]);
    expect(allocation.total.toFixed()).toBe("0");
  });
});

describe("computeAllocation: orden estable", () => {
  it("con valores iguales, el efectivo va primero y después por nombre, sin importar el orden de carga", () => {
    const build = (symbols: string[]) => {
      const result = computeEngine([
        deposit(T0, "3000"),
        ...symbols.map((s) => buy(T1, s, "10", "100")),
      ]);
      return valuePortfolio(
        result,
        new Map(symbols.map((s) => [s, quote("100")] as const)),
      );
    };
    // BBB y AAA valen 1000 cada uno y el efectivo también (3000 − 2000).
    const a = computeAllocation(build(["AAA", "BBB"]), bySymbol);
    const b = computeAllocation(build(["BBB", "AAA"]), bySymbol);
    expect(summary(a.slices)).toEqual([
      ["cash", "", "1000"],
      ["group", "AAA", "1000"],
      ["group", "BBB", "1000"],
    ]);
    expect(summary(b.slices)).toEqual(summary(a.slices));
  });
});
