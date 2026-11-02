import { describe, expect, it } from "vitest";
import { markdownReport, summarizeModel } from "../evals/report";
import type { CaseResult } from "../evals/runner";

const result = (
  id: string,
  split: "dev" | "test",
  passed: boolean,
  run = 0,
): CaseResult => ({
  model: "m",
  servedModel: null,
  run,
  mode: "agent",
  id,
  category: "posiciones",
  split,
  question: "?",
  score: {
    toolOk: true,
    numericOk: true,
    invented: [],
    fabricatedNumbers: [],
    roundedNumbers: [],
    fabricated: false,
    rounded: false,
    hallucinated: false,
    guardrailOk: null,
    passed,
  },
  text: "",
  tools: [],
  steps: 1,
  inputTokens: 1,
  outputTokens: 1,
  costUsd: null,
  ttftMs: 1,
  latencyMs: 1,
  error: null,
});

describe("reporte de evals", () => {
  it("separa el resultado de dev y de test", () => {
    const summary = summarizeModel("m", [
      result("a", "dev", true),
      result("b", "dev", true),
      result("c", "test", false),
      result("d", "test", true),
    ]);
    expect(summary.bySplit).toEqual({
      dev: { cases: 2, passed: 2 },
      test: { cases: 2, passed: 1 },
    });
    const md = markdownReport([summary], { date: "2026-09-30", cases: 4 });
    expect(md).toContain("## Por split");
    expect(md).toContain("n=2: 100 % [34–100]");
    expect(md).toContain("n=2: 50 % [9–91]");
  });

  it("con k corridas calcula pass@1, pass^k y pass@k a mano", () => {
    // a: 3/3, b: 1/3, c: 0/3, d: 2/3  -> 6 de 12 pares aprueban.
    const rows = [
      ...[true, true, true].map((p, i) => result("a", "dev", p, i)),
      ...[true, false, false].map((p, i) => result("b", "dev", p, i)),
      ...[false, false, false].map((p, i) => result("c", "test", p, i)),
      ...[true, true, false].map((p, i) => result("d", "test", p, i)),
    ];
    const s = summarizeModel("m", rows);
    expect(s.runs).toBe(3);
    expect(s.distinctCases).toBe(4);
    expect(s.overall.passAt1).toBe(6 / 12);
    expect(s.overall.passHatK).toBe(1 / 4);
    expect(s.overall.passAtK).toBe(3 / 4);
    // Wilson 6/12 con z = 1,96: [0,2538; 0,7462]
    expect(s.passCI!.lo).toBeCloseTo(0.2538, 3);
    expect(s.passCI!.hi).toBeCloseTo(0.7462, 3);
    expect(s.splitStats.dev).toMatchObject({ n: 6, passHatK: 0.5, passAtK: 1 });
    expect(s.splitStats.test).toMatchObject({
      n: 6,
      passHatK: 0,
      passAtK: 0.5,
    });
    const md = markdownReport([s], {
      date: "2026-09-30",
      cases: 4,
      runs: 3,
      mode: "sin_tools",
    });
    expect(md).toContain("sin tools, k=3");
    expect(md).toContain("n=6");
    expect(md).toContain("[25–75]");
  });
});
