import { percentile } from "../usage-view";
import type { Category } from "./cases";
import type { CaseResult } from "./runner";

// Resumen de una corrida de evals por modelo y la tabla en markdown para el README y el post.

export interface ModelSummary {
  model: string;
  cases: number;
  passed: number;
  errors: number;
  /** Fracciones (0–1); `null` si no hubo casos de ese tipo. */
  passRate: number | null;
  numericAccuracy: number | null;
  toolAccuracy: number | null;
  hallucinationRate: number | null;
  guardrailRate: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  ttftP50Ms: number | null;
  avgTokens: number | null;
  /** Requests al modelo (un paso = una request). */
  requests: number;
  costUsd: number | null;
  byCategory: Partial<Record<Category, { cases: number; passed: number }>>;
}

const share = (hits: number, total: number): number | null =>
  total === 0 ? null : hits / total;

export function summarizeModel(
  model: string,
  results: readonly CaseResult[],
): ModelSummary {
  const own = results.filter((r) => r.model === model);
  const scored = own.filter((r) => r.score !== null);
  const numeric = scored.filter((r) => r.score!.numericOk !== null);
  const guarded = scored.filter((r) => r.score!.guardrailOk !== null);
  const tokens = scored.flatMap((r) =>
    r.inputTokens === null && r.outputTokens === null
      ? []
      : [(r.inputTokens ?? 0) + (r.outputTokens ?? 0)],
  );
  const costs = own.flatMap((r) => (r.costUsd === null ? [] : [r.costUsd]));

  const byCategory: ModelSummary["byCategory"] = {};
  for (const r of own) {
    const current = byCategory[r.category] ?? { cases: 0, passed: 0 };
    byCategory[r.category] = {
      cases: current.cases + 1,
      passed: current.passed + (r.score?.passed ? 1 : 0),
    };
  }

  return {
    model,
    cases: own.length,
    passed: own.filter((r) => r.score?.passed).length,
    errors: own.filter((r) => r.error !== null).length,
    // Un error de la API cuenta como fallo: el modelo no respondió.
    passRate: share(own.filter((r) => r.score?.passed).length, own.length),
    numericAccuracy: share(
      numeric.filter((r) => r.score!.numericOk).length,
      numeric.length,
    ),
    toolAccuracy: share(
      scored.filter((r) => r.score!.toolOk).length,
      scored.length,
    ),
    hallucinationRate: share(
      scored.filter((r) => r.score!.hallucinated).length,
      scored.length,
    ),
    guardrailRate: share(
      guarded.filter((r) => r.score!.guardrailOk).length,
      guarded.length,
    ),
    latencyP50Ms: percentile(
      scored.map((r) => r.latencyMs),
      50,
    ),
    latencyP95Ms: percentile(
      scored.map((r) => r.latencyMs),
      95,
    ),
    ttftP50Ms: percentile(
      scored.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs])),
      50,
    ),
    avgTokens:
      tokens.length === 0
        ? null
        : tokens.reduce((a, b) => a + b, 0) / tokens.length,
    requests: own.reduce((acc, r) => acc + Math.max(r.steps, 1), 0),
    costUsd: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0),
    byCategory,
  };
}

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(0)} %`;
const secs = (ms: number | null): string =>
  ms === null ? "—" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
const usd = (value: number | null): string =>
  value === null
    ? "—"
    : value === 0
      ? "US$ 0"
      : `US$ ${value.toFixed(4).replace(".", ",")}`;

export function markdownReport(
  summaries: readonly ModelSummary[],
  meta: { date: string; cases: number },
): string {
  const header = [
    "| Modelo | Aprobadas | Acierto numérico | Tool correcta | Alucinación | Guardrails | Latencia p50 | p95 | Tokens/pregunta | Costo total |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const rows = summaries.map(
    (s) =>
      `| \`${s.model}\` | ${s.passed}/${s.cases} (${pct(s.passRate)}) | ${pct(s.numericAccuracy)} | ${pct(s.toolAccuracy)} | ${pct(s.hallucinationRate)} | ${pct(s.guardrailRate)} | ${secs(s.latencyP50Ms)} | ${secs(s.latencyP95Ms)} | ${s.avgTokens === null ? "—" : Math.round(s.avgTokens).toLocaleString("es-UY")} | ${usd(s.costUsd)} |`,
  );
  const categories = [
    ...new Set(summaries.flatMap((s) => Object.keys(s.byCategory))),
  ] as Category[];
  const byCategory = [
    `| Categoría | ${summaries.map((s) => `\`${s.model.split("/").at(-1)}\``).join(" | ")} |`,
    `|---|${summaries.map(() => "---").join("|")}|`,
    ...categories.map(
      (c) =>
        `| ${c} | ${summaries
          .map((s) => {
            const cell = s.byCategory[c];
            return cell ? `${cell.passed}/${cell.cases}` : "—";
          })
          .join(" | ")} |`,
    ),
  ];
  return [
    `# Evals del asistente (${meta.date})`,
    "",
    `${meta.cases} preguntas sobre una cartera demo ficticia. La respuesta correcta de cada una la calcula el motor de la app; el modelo solo elige la tool y explica.`,
    "",
    ...header,
    ...rows,
    "",
    "## Por categoría",
    "",
    ...byCategory,
    "",
  ].join("\n");
}
