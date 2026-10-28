import type { StreamTextEndEvent, ToolSet } from "ai";
import { costOf } from "./provider";
import type { ToolTiming } from "./tools";

// Métricas de un turno del asistente: qué tools corrieron, tokens, costo, latencia y errores.
// Nunca el contenido de los mensajes. Lo comparten la app (`assistant_runs`) y los evals.

export interface RunMetrics {
  model: string | null;
  fallbackUsed: boolean;
  steps: number;
  tools: ToolTiming[];
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ttftMs: number | null;
  latencyMs: number;
  finishReason: string | null;
  errorCode: string | null;
  compacted: boolean;
  contextTokensBefore: number | null;
  contextTokensAfter: number | null;
}

const count = (value: number | undefined): number | null =>
  value === undefined || !Number.isFinite(value) ? null : Math.round(value);

/** Arma la fila a partir del evento final del stream (o de un error, sin evento). */
export function summarizeRun(args: {
  event: StreamTextEndEvent<ToolSet> | null;
  requestedModel: string;
  timings: readonly ToolTiming[];
  latencyMs: number;
  errorCode: string | null;
}): RunMetrics {
  const { event } = args;
  const steps = event?.steps ?? [];
  const costs = steps.map((step) => costOf(step.providerMetadata));
  const servedBy = event?.response.modelId ?? null;
  return {
    model: servedBy ?? args.requestedModel,
    // OpenRouter informa el modelo que respondió: si no es el pedido, entró el respaldo.
    fallbackUsed:
      servedBy !== null && !sameModel(servedBy, args.requestedModel),
    steps: steps.length,
    tools: [...args.timings],
    inputTokens: count(event?.totalUsage.inputTokens),
    outputTokens: count(event?.totalUsage.outputTokens),
    costUsd: costs.some((c) => c !== null)
      ? costs.reduce<number>((acc, c) => acc + (c ?? 0), 0)
      : null,
    ttftMs: count(steps[0]?.performance.timeToFirstOutputMs),
    latencyMs: Math.max(0, Math.round(args.latencyMs)),
    finishReason: event?.finishReason ?? null,
    errorCode: args.errorCode,
    compacted: false,
    contextTokensBefore: null,
    contextTokensAfter: null,
  };
}

/** `nvidia/x:free` y `nvidia/x` son el mismo modelo (OpenRouter a veces omite el sufijo). */
function sameModel(served: string, requested: string): boolean {
  const base = (id: string) => id.replace(/:free$/, "");
  return base(served) === base(requested);
}

/** Un código corto y sin datos para la columna `error_code`. */
export function errorCodeOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.statusCode === "number")
      return `http_${record.statusCode}`;
    if (typeof record.name === "string" && record.name !== "Error") {
      return record.name.slice(0, 60);
    }
  }
  return "unknown";
}
