import { describe, expect, it } from "vitest";
import type { ResolveResult } from "@/lib/market-jobs/instruments";
import { verifyNewSymbols } from "../import-symbols";

const found = (symbol: string): ResolveResult => ({
  ok: true,
  instrument: { symbol, name: `${symbol} Inc`, type: "STOCK" },
});
const notFound: ResolveResult = {
  ok: false,
  reason: "NOT_FOUND",
  message: "No encontramos el símbolo",
};

describe("verifyNewSymbols", () => {
  it("devuelve un resultado por símbolo, sin repetir consultas", async () => {
    const asked: string[] = [];
    const results = await verifyNewSymbols(
      async (symbol) => {
        asked.push(symbol);
        return symbol === "APPL" ? notFound : found(symbol);
      },
      ["VOO", "APPL", "VOO", "AAPL"],
    );
    expect([...results.keys()].sort()).toEqual(["AAPL", "APPL", "VOO"]);
    expect(asked.sort()).toEqual(["AAPL", "APPL", "VOO"]);
    expect(results.get("VOO")).toEqual(found("VOO"));
    expect(results.get("APPL")).toEqual(notFound);
  });

  it("no lanza si no hay nada que verificar", async () => {
    expect(await verifyNewSymbols(async () => found("X"), [])).toEqual(
      new Map(),
    );
  });

  it("no verifica más de `concurrency` a la vez", async () => {
    let running = 0;
    let peak = 0;
    const symbols = Array.from({ length: 12 }, (_, i) => `S${i}`);
    await verifyNewSymbols(
      async (symbol) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return found(symbol);
      },
      symbols,
      { concurrency: 3 },
    );
    expect(peak).toBe(3);
  });

  it("un símbolo que tarda demasiado queda como no disponible, sin frenar a los demás", async () => {
    const results = await verifyNewSymbols(
      (symbol) =>
        symbol === "LENTO"
          ? new Promise<ResolveResult>(() => undefined)
          : Promise.resolve(found(symbol)),
      ["LENTO", "VOO"],
      { timeoutMs: 20 },
    );
    expect(results.get("VOO")).toEqual(found("VOO"));
    expect(results.get("LENTO")).toMatchObject({
      ok: false,
      reason: "UNAVAILABLE",
    });
  });

  it("si el verificador lanza, cuenta como no disponible", async () => {
    const results = await verifyNewSymbols(async () => {
      throw new Error("boom");
    }, ["VOO"]);
    expect(results.get("VOO")).toMatchObject({
      ok: false,
      reason: "UNAVAILABLE",
    });
  });
});
