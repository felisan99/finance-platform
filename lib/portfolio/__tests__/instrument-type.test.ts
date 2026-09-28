import { describe, expect, it } from "vitest";
import { benchmarkLabel, BENCHMARK_SYMBOLS } from "../benchmarks";
import { groupOfInstrument } from "../before-buy-data";
import { typeLabelOf } from "../instrument-type";
import { benchmarkSchema } from "@/lib/validation/portfolio";

describe("typeLabelOf", () => {
  it("acción, ETF y cripto; sin tipo, nada", () => {
    expect(typeLabelOf("STOCK")).toBe("Acción");
    expect(typeLabelOf("ETF")).toBe("ETF");
    expect(typeLabelOf("CRYPTO")).toBe("Cripto");
    expect(typeLabelOf(null)).toBeNull();
    expect(typeLabelOf(undefined)).toBeNull();
    // Un tipo que no conocemos se muestra como acción (el caso más común).
    expect(typeLabelOf("OTRO")).toBe("Acción");
  });
});

describe("benchmarks", () => {
  it("la lista corta: S&P 500 y Bitcoin, con su nombre", () => {
    expect(BENCHMARK_SYMBOLS).toEqual(["SPY", "BTC-USD"]);
    expect(benchmarkLabel("SPY")).toBe("S&P 500");
    expect(benchmarkLabel("BTC-USD")).toBe("Bitcoin");
    expect(benchmarkLabel("QQQ")).toBe("QQQ");
    expect(benchmarkLabel(null)).toBe("Benchmark");
  });

  it("solo se puede elegir uno de la lista", () => {
    expect(benchmarkSchema.safeParse("BTC-USD").success).toBe(true);
    expect(benchmarkSchema.safeParse("SPY").success).toBe(true);
    for (const bad of ["QQQ", "spy", "", null, undefined, "BTC-USD "]) {
      expect(benchmarkSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe("groupOfInstrument («Antes de comprar»)", () => {
  it("ETF y cripto son su propio grupo; una acción, su sector", () => {
    expect(groupOfInstrument({ type: "ETF", sector: null })).toBe("ETF");
    expect(groupOfInstrument({ type: "CRYPTO", sector: null })).toBe("CRYPTO");
    expect(groupOfInstrument({ type: "STOCK", sector: " Technology " })).toBe(
      "Technology",
    );
    expect(groupOfInstrument({ type: "STOCK", sector: null })).toBeNull();
  });
});
