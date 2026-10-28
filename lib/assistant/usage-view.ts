import { z } from "zod";
import { TOOL_LABELS } from "./tool-result";

// Métricas de uso del asistente para la pantalla "Más → Asistente", a partir de `assistant_runs`.
// Son conteos y tiempos para mostrar, no montos: se calculan con `number`.

export const runRowSchema = z.object({
  created_at: z.string(),
  model: z.string().nullable(),
  fallback_used: z.boolean(),
  steps: z.number(),
  tools: z.array(
    z.object({ name: z.string(), ok: z.boolean(), ms: z.number() }),
  ),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  ttft_ms: z.number().nullable(),
  latency_ms: z.number().nullable(),
  error_code: z.string().nullable(),
  compacted: z.boolean(),
  context_tokens_before: z.number().nullable(),
  context_tokens_after: z.number().nullable(),
});
export type RunRow = z.infer<typeof runRowSchema>;

export const RUN_COLUMNS =
  "created_at, model, fallback_used, steps, tools, input_tokens, output_tokens, ttft_ms, latency_ms, error_code, compacted, context_tokens_before, context_tokens_after";

export interface UsageView {
  turns: number;
  errors: number;
  fallbackShare: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  ttftP50: number | null;
  avgSteps: number | null;
  avgTokens: number | null;
  tools: Array<{
    name: string;
    label: string;
    calls: number;
    failures: number;
  }>;
  models: Array<{ model: string; turns: number }>;
  compactions: number;
  /** Ahorro medio de contexto al compactar (fracción); `null` sin compactaciones. */
  compactionSaving: number | null;
}

/** Percentil por el método del rango más cercano; `null` sin datos. */
export function percentile(
  values: readonly number[],
  p: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;

export function buildUsageView(rows: readonly RunRow[]): UsageView {
  const latencies = rows.flatMap((r) =>
    r.latency_ms === null ? [] : [r.latency_ms],
  );
  const ttfts = rows.flatMap((r) => (r.ttft_ms === null ? [] : [r.ttft_ms]));
  const tokens = rows.flatMap((r) =>
    r.input_tokens === null && r.output_tokens === null
      ? []
      : [(r.input_tokens ?? 0) + (r.output_tokens ?? 0)],
  );

  const tools = new Map<string, { calls: number; failures: number }>();
  for (const row of rows) {
    for (const call of row.tools) {
      const current = tools.get(call.name) ?? { calls: 0, failures: 0 };
      tools.set(call.name, {
        calls: current.calls + 1,
        failures: current.failures + (call.ok ? 0 : 1),
      });
    }
  }
  const models = new Map<string, number>();
  for (const row of rows) {
    if (row.model) models.set(row.model, (models.get(row.model) ?? 0) + 1);
  }
  const compacted = rows.filter(
    (r) =>
      r.compacted &&
      r.context_tokens_before !== null &&
      r.context_tokens_after !== null &&
      r.context_tokens_before > 0,
  );

  return {
    turns: rows.length,
    errors: rows.filter((r) => r.error_code !== null).length,
    fallbackShare:
      rows.length === 0
        ? null
        : rows.filter((r) => r.fallback_used).length / rows.length,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    ttftP50: percentile(ttfts, 50),
    avgSteps: mean(rows.map((r) => r.steps)),
    avgTokens: mean(tokens),
    tools: [...tools.entries()]
      .map(([name, stats]) => ({
        name,
        label: TOOL_LABELS[name] ?? name,
        ...stats,
      }))
      .sort((a, b) => b.calls - a.calls || (a.name < b.name ? -1 : 1)),
    models: [...models.entries()]
      .map(([model, turns]) => ({ model, turns }))
      .sort((a, b) => b.turns - a.turns),
    compactions: rows.filter((r) => r.compacted).length,
    compactionSaving: mean(
      compacted.map(
        (r) => 1 - r.context_tokens_after! / r.context_tokens_before!,
      ),
    ),
  };
}

export type UsageOutcome = { ok: true; usage: UsageView } | { ok: false };

/**
 * Distingue "todavía no hay datos" (consulta bien, sin filas) de "no se pudo
 * cargar" (error de la consulta o filas inválidas): en el segundo caso no se
 * deben mostrar ceros como si fueran reales.
 */
export function resolveUsage(
  queryFailed: boolean,
  data: unknown,
): UsageOutcome {
  if (queryFailed) return { ok: false };
  const parsed = runRowSchema.array().safeParse(data ?? []);
  return parsed.success
    ? { ok: true, usage: buildUsageView(parsed.data) }
    : { ok: false };
}

const seconds = new Intl.NumberFormat("es-UY", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const decimal = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 0 });

/** `6532` → `6,5 s`; `null` → `—`. */
export const formatSeconds = (ms: number | null): string =>
  ms === null ? "—" : `${seconds.format(ms / 1000)} s`;
/** Promedios chicos (pasos): `2,4`. */
export const formatAverage = (value: number | null): string =>
  value === null ? "—" : decimal.format(value);
/** Conteos grandes (tokens): `6.491`. */
export const formatCount = (value: number | null): string =>
  value === null ? "—" : whole.format(value);
