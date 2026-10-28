import { APICallError, type LanguageModel } from "ai";
import { runAssistant } from "../agent";
import { demoDataSource } from "../fixture/demo-data-source";
import { demoNews, demoWeb, inMemoryStore } from "../fixture/demo-deps";
import { DEMO_NOW, DEMO_TODAY } from "../fixture/demo-portfolio";
import { buildSystemPrompt } from "../prompt";
import { costOf } from "../provider";
import { buildTools, type ToolTiming } from "../tools";
import type { Category, EvalCase } from "./cases";
import { scoreCase, type CaseScore, type ToolCallRecord } from "./score";

// Corre una pregunta de los evals contra un modelo: la cartera demo, memoria vacía y noticias
// simuladas, con el mismo loop, prompt y tools que la app. Mide tokens, costo y tiempos.

export interface CaseResult {
  model: string;
  id: string;
  category: Category;
  question: string;
  score: CaseScore | null;
  text: string;
  tools: string[];
  steps: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ttftMs: number | null;
  latencyMs: number;
  error: string | null;
}

/** Fecha con la que el prompt arranca en los evals (la de la cartera demo). */
const TODAY_TEXT = "miércoles, 30 de setiembre de 2026";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** No más de `perMinute` requests al modelo en cualquier ventana de 60 s (los gratuitos cortan en 20). */
export class RequestPacer {
  private readonly stamps: number[] = [];
  constructor(private readonly perMinute: number) {}
  async reserve(requests: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.stamps.length && now - this.stamps[0]! > 60_000) {
        this.stamps.shift();
      }
      if (this.stamps.length + requests <= this.perMinute) return;
      await sleep(1000);
    }
  }
  record(requests: number): void {
    const now = Date.now();
    for (let i = 0; i < requests; i++) this.stamps.push(now);
  }
}

const RETRY_WAITS_MS = [20_000, 60_000];

export async function runCase(args: {
  model: LanguageModel;
  modelId: string;
  evalCase: EvalCase;
  pacer: RequestPacer;
  maxStepsPerCase: number;
}): Promise<CaseResult> {
  const { evalCase } = args;
  const expectation = await evalCase.expect(demoDataSource(DEMO_NOW));

  for (let attempt = 0; ; attempt++) {
    const ds = demoDataSource(DEMO_NOW);
    const memory = inMemoryStore();
    const timings: ToolTiming[] = [];
    const tools = buildTools({
      ds,
      memory,
      news: {
        search: demoNews,
        takeLimit: async () => true,
        holds: async (symbol) =>
          (await ds.snapshot()).valued.positions.some(
            (p) => p.isOpen && p.symbol === symbol,
          ),
      },
      web: { search: demoWeb, takeLimit: async () => true },
      timings,
    });
    await args.pacer.reserve(args.maxStepsPerCase);
    const started = performance.now();
    try {
      const result = runAssistant({
        model: args.model,
        instructions: buildSystemPrompt({
          todayText: TODAY_TEXT,
          todayKey: DEMO_TODAY,
          scopeName: ds.scopeName,
          memories: [],
          summary: null,
          hasNews: true,
          hasMemory: true,
        }),
        messages: [{ role: "user", content: evalCase.question }],
        tools,
      });
      const [text, steps, usage] = await Promise.all([
        result.text,
        result.steps,
        result.totalUsage,
      ]);
      const latencyMs = performance.now() - started;
      args.pacer.record(steps.length);

      const calls: ToolCallRecord[] = steps.flatMap((step) =>
        step.toolCalls.map((call) => ({
          name: call.toolName,
          input: call.input,
          output:
            step.toolResults.find((r) => r.toolCallId === call.toolCallId)
              ?.output ?? null,
        })),
      );
      const costs = steps.map((step) => costOf(step.providerMetadata));
      return {
        model: args.modelId,
        id: evalCase.id,
        category: evalCase.category,
        question: evalCase.question,
        score: scoreCase(evalCase.question, expectation, {
          text,
          calls,
          memories: memory.items.map((m) => m.content),
        }),
        text,
        tools: calls.map((c) => c.name),
        steps: steps.length,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        costUsd: costs.some((c) => c !== null)
          ? costs.reduce<number>((acc, c) => acc + (c ?? 0), 0)
          : null,
        ttftMs: steps[0]?.performance.timeToFirstOutputMs ?? null,
        latencyMs,
        error: null,
      };
    } catch (error) {
      args.pacer.record(1);
      const status = APICallError.isInstance(error) ? error.statusCode : null;
      const wait = RETRY_WAITS_MS[attempt];
      if ((status === 429 || (status ?? 0) >= 500) && wait !== undefined) {
        await sleep(wait);
        continue;
      }
      return {
        model: args.modelId,
        id: evalCase.id,
        category: evalCase.category,
        question: evalCase.question,
        score: null,
        text: "",
        tools: timings.map((t) => t.name),
        steps: 0,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        ttftMs: null,
        latencyMs: performance.now() - started,
        error: status
          ? `http_${status}`
          : error instanceof Error
            ? error.message.slice(0, 200)
            : "unknown",
      };
    }
  }
}
