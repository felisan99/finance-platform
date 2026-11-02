import { describe, expect, it } from "vitest";
import { estimateRequests, parseNoTools, parseRuns } from "../evals/select";
import { passStats, wilsonInterval } from "../evals/stats";
import { evalSettings, sha256 } from "../evals/metadata";

describe("intervalo de Wilson", () => {
  it("5 de 10 da [0,2366; 0,7634] (a mano)", () => {
    // p = 0,5; z² = 3,8416; centro 0,5; mitad = 1,96·√(0,025 + 0,009604) / 1,38416 = 0,2634
    const ci = wilsonInterval(5, 10)!;
    expect(ci.lo).toBeCloseTo(0.2366, 3);
    expect(ci.hi).toBeCloseTo(0.7634, 3);
  });

  it("los extremos no se salen de [0, 1] y no son degenerados", () => {
    // 0 de 10: hi = z² / (n + z²) = 3,8416 / 13,8416
    const none = wilsonInterval(0, 10)!;
    expect(none.lo).toBe(0);
    expect(none.hi).toBeCloseTo(0.2775, 3);
    const all = wilsonInterval(10, 10)!;
    expect(all.lo).toBeCloseTo(0.7225, 3);
    expect(all.hi).toBe(1);
  });

  it("sin muestra no hay intervalo", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe("pass@1, pass^k y pass@k", () => {
  it("se calculan sobre preguntas", () => {
    const stats = passStats(
      new Map([
        ["a", [true, true]],
        ["b", [true, false]],
        ["c", [false, false]],
      ]),
    );
    expect(stats).toEqual({
      cases: 3,
      k: 2,
      passAt1: 3 / 6,
      passHatK: 1 / 3,
      passAtK: 2 / 3,
    });
  });

  it("vacío da nulos", () => {
    expect(passStats(new Map()).passAt1).toBeNull();
  });
});

describe("ajustes de la corrida", () => {
  it("EVAL_RUNS: por defecto 1, de 1 a 10, lo demás tira", () => {
    expect(parseRuns(undefined)).toBe(1);
    expect(parseRuns("")).toBe(1);
    expect(parseRuns("3")).toBe(3);
    expect(parseRuns("10")).toBe(10);
    for (const bad of ["0", "11", "1.5", "-2", "abc"]) {
      expect(() => parseRuns(bad), bad).toThrow();
    }
  });

  it("EVAL_NO_TOOLS acepta 1/0 y rechaza el resto", () => {
    expect(parseNoTools(undefined)).toBe(false);
    expect(parseNoTools("0")).toBe(false);
    expect(parseNoTools("1")).toBe(true);
    expect(() => parseNoTools("si")).toThrow();
  });

  it("las requests escalan con k y sin tools es una por par", () => {
    const base = { cases: 10, models: 2, noTools: false, maxSteps: 6 };
    expect(estimateRequests({ ...base, runs: 1 })).toEqual({
      expected: 50,
      max: 120,
    });
    expect(estimateRequests({ ...base, runs: 3 })).toEqual({
      expected: 150,
      max: 360,
    });
    expect(estimateRequests({ ...base, runs: 3, noTools: true })).toEqual({
      expected: 60,
      max: 60,
    });
  });

  it("solo se guardan las variables EVAL_ y el hash es SHA-256", () => {
    expect(
      evalSettings({
        EVAL_RUNS: "3",
        OPENROUTER_API_KEY: "x",
        EVAL_X: undefined,
      }),
    ).toEqual({ EVAL_RUNS: "3" });
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
