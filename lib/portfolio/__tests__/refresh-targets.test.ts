import { describe, expect, it } from "vitest";
import { collectRefreshTargets, refreshMessage } from "../refresh-targets";
import type { InstrumentRow } from "../rows";

const instrument = (symbol: string): InstrumentRow => ({
  id: `id-${symbol}`,
  symbol,
  name: null,
  type: null,
  exchange: null,
  sector: null,
  provider_symbol: null,
});
const bySymbol = (...symbols: string[]) =>
  new Map(symbols.map((s) => [s, instrument(s)]));
const symbolsOf = (list: readonly InstrumentRow[]) => list.map((i) => i.symbol);

describe("collectRefreshTargets", () => {
  it("posiciones abiertas, seguidos y benchmark, sin repetir", () => {
    const targets = collectRefreshTargets({
      openSymbols: ["VOO", "AAPL"],
      instrumentBySymbol: bySymbol("VOO", "AAPL"),
      followed: [instrument("AAPL"), instrument("MSFT")],
      benchmarks: [instrument("SPY")],
    });
    expect(symbolsOf(targets.instruments)).toEqual([
      "VOO",
      "AAPL",
      "MSFT",
      "SPY",
    ]);
    expect(symbolsOf(targets.extraBenchmarks)).toEqual(["SPY"]);
  });

  it("si la persona ya tiene o sigue el benchmark no se agrega de más ni cuenta aparte", () => {
    const held = collectRefreshTargets({
      openSymbols: ["SPY"],
      instrumentBySymbol: bySymbol("SPY"),
      followed: [],
      benchmarks: [instrument("SPY")],
    });
    expect(symbolsOf(held.instruments)).toEqual(["SPY"]);
    expect(held.extraBenchmarks).toEqual([]);

    const followed = collectRefreshTargets({
      openSymbols: [],
      instrumentBySymbol: new Map(),
      followed: [instrument("SPY")],
      benchmarks: [instrument("SPY")],
    });
    expect(symbolsOf(followed.instruments)).toEqual(["SPY"]);
    expect(followed.extraBenchmarks).toEqual([]);
  });

  it("sin posiciones ni seguidos no hay nada que actualizar, ni siquiera el benchmark", () => {
    const targets = collectRefreshTargets({
      openSymbols: [],
      instrumentBySymbol: new Map(),
      followed: [],
      benchmarks: [instrument("SPY")],
    });
    expect(targets).toEqual({ instruments: [], extraBenchmarks: [] });
  });

  it("sin benchmark actualiza lo demás", () => {
    const targets = collectRefreshTargets({
      openSymbols: ["VOO"],
      instrumentBySymbol: bySymbol("VOO"),
      followed: [],
      benchmarks: [],
    });
    expect(symbolsOf(targets.instruments)).toEqual(["VOO"]);
    expect(targets.extraBenchmarks).toEqual([]);
  });

  it("varios portafolios: cada benchmark una sola vez y solo los que no se tienen cuentan aparte", () => {
    const targets = collectRefreshTargets({
      openSymbols: ["VOO", "QQQ"],
      instrumentBySymbol: bySymbol("VOO", "QQQ"),
      followed: [],
      benchmarks: [instrument("SPY"), instrument("QQQ"), instrument("SPY")],
    });
    expect(symbolsOf(targets.instruments)).toEqual(["VOO", "QQQ", "SPY"]);
    expect(symbolsOf(targets.extraBenchmarks)).toEqual(["SPY"]);
  });

  it("un símbolo abierto que no vino en los instrumentos se omite", () => {
    const targets = collectRefreshTargets({
      openSymbols: ["VOO", "FANTASMA"],
      instrumentBySymbol: bySymbol("VOO"),
      followed: [],
      benchmarks: [],
    });
    expect(symbolsOf(targets.instruments)).toEqual(["VOO"]);
  });
});

describe("refreshMessage", () => {
  const spy = [{ symbol: "SPY" }];

  it("cuenta lo que la persona tiene: el benchmark agregado por nosotros no suma", () => {
    expect(refreshMessage({ updated: 3, missing: [] }, spy)).toBe(
      "Precios actualizados (2).",
    );
  });

  it("sin benchmark agregado cuenta todo", () => {
    expect(refreshMessage({ updated: 2, missing: [] }, [])).toBe(
      "Precios actualizados (2).",
    );
  });

  it("si falta la cotización del benchmark agregado no se avisa como falta de la persona", () => {
    expect(refreshMessage({ updated: 2, missing: ["SPY"] }, spy)).toBe(
      "Precios actualizados (2).",
    );
  });

  it("con dos benchmarks agregados, ninguno cuenta", () => {
    expect(
      refreshMessage({ updated: 3, missing: ["QQQ"] }, [
        { symbol: "SPY" },
        { symbol: "QQQ" },
      ]),
    ).toBe("Precios actualizados (2).");
  });

  it("lista los símbolos de la persona sin cotización", () => {
    expect(refreshMessage({ updated: 2, missing: ["ZZZ"] }, spy)).toBe(
      "Actualizado (1). Sin cotización: ZZZ.",
    );
    expect(refreshMessage({ updated: 1, missing: ["ZZZ", "SPY"] }, spy)).toBe(
      "Actualizado (1). Sin cotización: ZZZ.",
    );
    expect(refreshMessage({ updated: 1, missing: ["ZZZ"] }, [])).toBe(
      "Actualizado (1). Sin cotización: ZZZ.",
    );
  });
});
