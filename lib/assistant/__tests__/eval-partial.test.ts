import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { EvalCase } from "../evals/cases";
import { loadPartial, runAll } from "../evals/partial";
import { RequestPacer, runCase, type CaseResult } from "../evals/runner";

const evalCase = (id: string): EvalCase => ({
  id,
  category: "posiciones",
  split: "dev",
  question: "?",
  expect: async () => ({ kind: "off_topic", tools: [], anchors: [] }),
});
const fake = (
  model: string,
  id: string,
  run: number,
  error: string | null = null,
): CaseResult => ({
  model,
  servedModel: null,
  run,
  mode: "agent",
  id,
  category: "posiciones",
  split: "dev",
  question: "?",
  score: null,
  text: "",
  tools: [],
  steps: 1,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  ttftMs: null,
  latencyMs: 1,
  error,
});
const tmp = () => join(mkdtempSync(join(tmpdir(), "eval-")), "x.partial.jsonl");

describe("guardado incremental y reanudación", () => {
  it("escribe cada resultado al terminar y al reanudar salta lo hecho", async () => {
    const path = tmp();
    const cases = [evalCase("a"), evalCase("b")];
    const calls: string[] = [];
    // Primera corrida: se corta después de 2 resultados.
    await expect(
      runAll({
        models: ["m"],
        cases,
        runs: 2,
        partialPath: path,
        runOne: async (m, c, run) => {
          if (calls.length === 2) throw new Error("corte");
          calls.push(`${c.id}${run}`);
          return fake(m, c.id, run);
        },
      }),
    ).rejects.toThrow("corte");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);

    const second: string[] = [];
    const results = await runAll({
      models: ["m"],
      cases,
      runs: 2,
      partialPath: path,
      runOne: async (m, c, run) => {
        second.push(`${c.id}${run}`);
        return fake(m, c.id, run);
      },
    });
    expect(second).toEqual(["b0", "b1"]);
    expect(results.map((r) => `${r.id}${r.run}`)).toEqual([
      "a0",
      "a1",
      "b0",
      "b1",
    ]);
    expect(loadPartial(path)).toHaveLength(4);
  });

  it("repite los errores de la API y tolera una última línea cortada", async () => {
    const path = tmp();
    writeFileSync(path, `${JSON.stringify(fake("m", "a", 0, "http_429"))}\n`);
    appendFileSync(path, '{"model":"m","id":"b"');
    const ran: string[] = [];
    await runAll({
      models: ["m"],
      cases: [evalCase("a")],
      runs: 1,
      partialPath: path,
      runOne: async (m, c, run) => {
        ran.push(c.id);
        return fake(m, c.id, run);
      },
    });
    expect(ran).toEqual(["a"]);
  });
});

describe("timeout del proveedor", () => {
  it("aborta el intento colgado, reintenta y cuenta el reintento", async () => {
    let calls = 0;
    const done = [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Hola" },
      { type: "text-end", id: "t" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      },
    ];
    const model = new MockLanguageModelV4({
      doStream: async () =>
        calls++ === 0
          ? { stream: new ReadableStream({ start() {} }) }
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partes de stream del mock
            { stream: simulateReadableStream({ chunks: done as any }) },
    });
    const result = await runCase({
      model,
      modelId: "m",
      evalCase: evalCase("q"),
      pacer: new RequestPacer(1000),
      maxStepsPerCase: 1,
      stepTimeoutMs: 50,
    });
    expect(result).toMatchObject({ error: null, text: "Hola", retries: 1 });
    expect(result.wallMs!).toBeGreaterThanOrEqual(result.latencyMs);
    expect(calls).toBe(2);
  });

  it("el tope absoluto aborta aunque el proveedor nunca emita ni respete la señal", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      // Nunca resuelve y no mira la señal.
      doStream: () => {
        calls++;
        return new Promise(() => undefined);
      },
    });
    const started = performance.now();
    const result = await runCase({
      model,
      modelId: "m",
      evalCase: evalCase("q"),
      pacer: new RequestPacer(1000),
      maxStepsPerCase: 1,
      runDeadlineMs: 80,
      maxTimeoutRetries: 2,
    });
    const elapsed = performance.now() - started;
    expect(result).toMatchObject({ error: "timeout", retries: 2 });
    expect(calls).toBe(3);
    expect(elapsed).toBeGreaterThanOrEqual(3 * 80 - 20);
    expect(elapsed).toBeLessThan(3 * 80 + 400);
  });

  it("si se cuelga siempre, termina con error timeout al llegar al tope", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({ stream: new ReadableStream({ start() {} }) }),
    });
    const result = await runCase({
      model,
      modelId: "m",
      evalCase: evalCase("q"),
      pacer: new RequestPacer(1000),
      maxStepsPerCase: 1,
      stepTimeoutMs: 30,
      maxTimeoutRetries: 1,
    });
    expect(result).toMatchObject({ error: "timeout", retries: 1 });
  });
});
