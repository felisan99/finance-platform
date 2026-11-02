import { describe, expect, it } from "vitest";
import type { EvalCase } from "../evals/cases";
import { rescoreResults } from "../evals/rescore";
import { MAX_STORED_OUTPUT_CHARS, storeCalls } from "../evals/runner";
import type { CaseResult } from "../evals/runner";
import type { CaseScore } from "../evals/score";

const evalCase: EvalCase = {
  id: "q",
  category: "posiciones",
  split: "dev",
  question: "¿Cuánto pesa VOO?",
  expect: async () => ({
    kind: "numeric",
    tools: ["get_positions"],
    anchors: ["16,91%"],
  }),
};
const oldScore: CaseScore = {
  toolOk: true,
  numericOk: false,
  invented: [],
  fabricatedNumbers: [],
  roundedNumbers: [],
  fabricated: false,
  rounded: false,
  hallucinated: false,
  guardrailOk: null,
  passed: false,
};
const base: CaseResult = {
  model: "m",
  servedModel: null,
  run: 0,
  mode: "agent",
  id: "q",
  category: "posiciones",
  split: "dev",
  question: "¿Cuánto pesa VOO?",
  score: oldScore,
  text: "VOO pesa 16,91%, ganó +224%.",
  tools: ["get_positions"],
  steps: 2,
  inputTokens: 1,
  outputTokens: 1,
  costUsd: null,
  ttftMs: 1,
  latencyMs: 1,
  error: null,
};
const withCalls: CaseResult = {
  ...base,
  calls: [
    {
      name: "get_positions",
      input: {},
      output: { peso: "16,91%", ganancia: "+223,87%" },
    },
  ],
  memories: [],
};

describe("re-puntuar un JSON guardado", () => {
  it("usa las tool calls guardadas, sin ejecutar nada", async () => {
    const { results, summaries } = await rescoreResults(
      { models: ["m"], results: [withCalls] },
      [evalCase],
      undefined as never,
    );
    expect(results[0]!.score).toMatchObject({
      passed: true,
      fabricated: false,
      rounded: true,
      roundedNumbers: ["224"],
    });
    expect(summaries[0]!.passRate).toBe(1);
    expect(summaries[0]!.roundedRate).toBe(1);
  });

  it("un JSON viejo sin calls se puntúa con los nombres de las tools", async () => {
    const { results } = await rescoreResults(
      { models: ["m"], results: [base] },
      [evalCase],
      undefined as never,
    );
    expect(results[0]!.score!.toolOk).toBe(true);
    expect(results[0]!.score!.fabricated).toBe(true);
  });

  it("deja igual un error de la API o una pregunta que ya no existe", async () => {
    const failed: CaseResult = { ...base, score: null, error: "http_429" };
    const unknown: CaseResult = { ...base, id: "otra" };
    const { results } = await rescoreResults(
      { models: ["m"], results: [failed, unknown] },
      [evalCase],
      undefined as never,
    );
    expect(results).toEqual([failed, unknown]);
  });
});

describe("storeCalls", () => {
  it("guarda tal cual lo chico y corta lo enorme marcándolo", () => {
    const big = { texto: "x".repeat(MAX_STORED_OUTPUT_CHARS) };
    const [small, cut] = storeCalls([
      { name: "a", input: { k: 1 }, output: { v: 1 } },
      { name: "b", input: {}, output: big },
    ]);
    expect(small).toEqual({ name: "a", input: { k: 1 }, output: { v: 1 } });
    expect(cut!.truncated).toBe(true);
    expect((cut!.output as string).length).toBe(MAX_STORED_OUTPUT_CHARS);
  });
});
