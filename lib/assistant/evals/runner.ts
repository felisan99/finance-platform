import { APICallError, type LanguageModel } from "ai";
import { runAssistant } from "../agent";
import { demoDataSource } from "../fixture/demo-data-source";
import { demoNews, demoWeb, inMemoryStore } from "../fixture/demo-deps";
import { DEMO_NOW, DEMO_TODAY } from "../fixture/demo-portfolio";
import { buildSystemPrompt } from "../prompt";
import { costOf } from "../provider";
import { buildTools, type ToolTiming } from "../tools";
import type { ToolSet } from "ai";
import type { EvalMode } from "./metadata";
import type { Category, EvalCase, Split } from "./cases";
import { scoreCase, type CaseScore, type ToolCallRecord } from "./score";

// Corre una pregunta de los evals contra un modelo: la cartera demo, memoria vacía y noticias
// simuladas, con el mismo loop, prompt y tools que la app. Mide tokens, costo y tiempos.

export interface CaseResult {
  model: string;
  /** Id que devolvió el proveedor (puede diferir del pedido); `null` si no respondió. */
  servedModel: string | null;
  /** Índice de la corrida (0-based) de esta pregunta con este modelo. */
  run: number;
  mode: EvalMode;
  id: string;
  category: Category;
  split: Split;
  question: string;
  score: CaseScore | null;
  text: string;
  tools: string[];
  /**
   * Las tool calls completas (entrada y salida que vio el modelo) y la memoria al terminar, para
   * re-puntuar sin volver a llamar a nadie. Los JSON viejos no las traen.
   */
  calls?: StoredCall[];
  memories?: string[];
  /** Reintentos por timeout (el proveedor se colgó); `latencyMs` es la del intento que respondió. */
  retries?: number;
  /** Tiempo total de pared de la pregunta, con los intentos colgados y las esperas incluidos. */
  wallMs?: number;
  steps: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ttftMs: number | null;
  latencyMs: number;
  error: string | null;
}

/** Tope por salida guardada: una tool puede devolver mucho texto (series largas). */
export const MAX_STORED_OUTPUT_CHARS = 20_000;

export interface StoredCall {
  name: string;
  input: unknown;
  output: unknown;
  /** La salida se cortó al guardarla: re-puntuar con ella puede marcar cifras de más. */
  truncated?: true;
}

export function storeCalls(calls: readonly ToolCallRecord[]): StoredCall[] {
  return calls.map((call) => {
    const json = JSON.stringify(call.output ?? null);
    return json.length <= MAX_STORED_OUTPUT_CHARS
      ? { name: call.name, input: call.input, output: call.output ?? null }
      : {
          name: call.name,
          input: call.input,
          output: json.slice(0, MAX_STORED_OUTPUT_CHARS),
          truncated: true,
        };
  });
}

/** Fecha con la que el prompt arranca en los evals (la de la cartera demo). */
const TODAY_TEXT = "miércoles, 30 de setiembre de 2026";

/** Entradas del prompt de los evals; sin tools no se ofrecen noticias ni memoria. */
export function evalPrompt(scopeName: string, mode: EvalMode): string {
  return buildSystemPrompt({
    todayText: TODAY_TEXT,
    todayKey: DEMO_TODAY,
    scopeName,
    memories: [],
    summary: null,
    hasNews: mode === "agent",
    hasMemory: mode === "agent",
  });
}

/** Las tools de los evals sobre la cartera demo (noticias y web simuladas, memoria en RAM). */
export function evalTools(
  ds: ReturnType<typeof demoDataSource>,
  memory: ReturnType<typeof inMemoryStore>,
  timings: ToolTiming[],
): ToolSet {
  return buildTools({
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
}

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

/** AI SDK corta por `timeout` con un `TimeoutError`. */
export const isTimeoutError = (error: unknown): boolean =>
  (error instanceof Error || error instanceof DOMException) &&
  (error.name === "TimeoutError" || error.name === "AbortError");

const RETRY_WAITS_MS = [20_000, 60_000];

export async function runCase(args: {
  model: LanguageModel;
  modelId: string;
  evalCase: EvalCase;
  pacer: RequestPacer;
  maxStepsPerCase: number;
  run?: number;
  /** Ablación: el mismo prompt y modelo, sin ninguna tool (responde de memoria). */
  noTools?: boolean;
  /** Corta un paso sin contenido nuevo por este tiempo y reintenta la pregunta; sin valor, no corta. */
  stepTimeoutMs?: number;
  /**
   * Tope ABSOLUTO por intento, desde que empieza hasta que termina (por defecto 180 s): aborta aunque
   * el proveedor no emita nada ni respete la señal. Cuenta como reintento por timeout.
   */
  runDeadlineMs?: number;
  /** Señal de la corrida entera; se combina con el tope de cada intento. */
  abortSignal?: AbortSignal;
  /** Reintentos máximos por timeout (por defecto 2). */
  maxTimeoutRetries?: number;
}): Promise<CaseResult> {
  const run = args.run ?? 0;
  const wallStart = performance.now();
  let timeoutRetries = 0;
  const maxTimeoutRetries = args.maxTimeoutRetries ?? 2;
  const mode: EvalMode = args.noTools ? "sin_tools" : "agent";
  const { evalCase } = args;
  const expectation = await evalCase.expect(demoDataSource(DEMO_NOW));

  for (let attempt = 0; ; attempt++) {
    const ds = demoDataSource(DEMO_NOW);
    const memory = inMemoryStore();
    const timings: ToolTiming[] = [];
    const tools = args.noTools ? {} : evalTools(ds, memory, timings);
    await args.pacer.reserve(args.noTools ? 1 : args.maxStepsPerCase);
    const started = performance.now();
    const deadline = AbortSignal.timeout(args.runDeadlineMs ?? 180_000);
    const signal = args.abortSignal
      ? AbortSignal.any([args.abortSignal, deadline])
      : deadline;
    try {
      const result = runAssistant({
        model: args.model,
        instructions: evalPrompt(ds.scopeName, mode),
        messages: [{ role: "user", content: evalCase.question }],
        tools,
        abortSignal: signal,
        // El tope absoluto manda: los reintentos internos del SDK no multiplican la espera.
        maxRetries: 0,
        timeout:
          args.stepTimeoutMs === undefined
            ? undefined
            : {
                firstChunkMs: args.stepTimeoutMs,
                chunkMs: args.stepTimeoutMs,
              },
      });
      const all = Promise.all([result.text, result.steps, result.totalUsage]);
      // Si la señal no corta la request colgada, la carrera igual libera el intento.
      all.catch(() => undefined);
      const [text, steps, usage] = await Promise.race([
        all,
        new Promise<never>((_, reject) => {
          const fail = () =>
            reject(
              Object.assign(new Error("run deadline"), {
                name: "TimeoutError",
              }),
            );
          if (deadline.aborted) fail();
          else deadline.addEventListener("abort", fail, { once: true });
        }),
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
        servedModel: steps.at(-1)?.response.modelId ?? null,
        run,
        mode,
        id: evalCase.id,
        category: evalCase.category,
        split: evalCase.split,
        question: evalCase.question,
        score: scoreCase(evalCase.question, expectation, {
          text,
          calls,
          memories: memory.items.map((m) => m.content),
        }),
        text,
        tools: calls.map((c) => c.name),
        calls: storeCalls(calls),
        memories: memory.items.map((m) => m.content),
        retries: timeoutRetries,
        wallMs: performance.now() - wallStart,
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
      if (isTimeoutError(error) && timeoutRetries < maxTimeoutRetries) {
        timeoutRetries++;
        continue;
      }
      const status = APICallError.isInstance(error) ? error.statusCode : null;
      const wait = RETRY_WAITS_MS[attempt];
      if ((status === 429 || (status ?? 0) >= 500) && wait !== undefined) {
        await sleep(wait);
        continue;
      }
      return {
        model: args.modelId,
        servedModel: null,
        run,
        mode,
        id: evalCase.id,
        category: evalCase.category,
        split: evalCase.split,
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
        retries: timeoutRetries,
        wallMs: performance.now() - wallStart,
        error: isTimeoutError(error)
          ? "timeout"
          : status
            ? `http_${status}`
            : error instanceof Error
              ? error.message.slice(0, 200)
              : "unknown",
      };
    }
  }
}
