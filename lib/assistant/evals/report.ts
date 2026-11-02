import { percentile } from "../usage-view";
import type { Category, Split } from "./cases";
import { modeLabel, type EvalMode } from "./metadata";
import type { CaseResult } from "./runner";
import {
  passStats,
  wilsonInterval,
  type Interval,
  type PassStats,
} from "./stats";

// Resumen de una corrida de evals por modelo y la tabla en markdown para el README y el post.

/** Estadística de un conjunto de pares pregunta-corrida: pass@1, pass^k, pass@k e IC de Wilson. */
export interface PassSummary extends PassStats {
  /** Pares pregunta-corrida (el `n` del intervalo). */
  n: number;
  passed: number;
  passCI: Interval | null;
}

export interface ModelSummary {
  model: string;
  mode: EvalMode | null;
  /** Corridas por pregunta. */
  runs: number;
  /** Preguntas distintas. */
  distinctCases: number;
  overall: PassSummary;
  passCI: Interval | null;
  hallucinationCI: Interval | null;
  fabricationCI: Interval | null;
  guardrailCI: Interval | null;
  /** Tamaños de muestra de cada tasa, para leer los intervalos. */
  hallucinationN: number;
  guardrailN: number;
  /** Casos-corridas (preguntas × corridas); las otras cuentas también son por par. */
  cases: number;
  passed: number;
  errors: number;
  /** Fracciones (0–1); `null` si no hubo casos de ese tipo. */
  passRate: number | null;
  numericAccuracy: number | null;
  toolAccuracy: number | null;
  /** Cualquier cifra no textual (estricta; comparable con corridas viejas). */
  hallucinationRate: number | null;
  /** Cifras sin fuente ni siquiera redondeada, o dato faltante inventado: hace fallar el caso. */
  fabricationRate: number | null;
  /** Solo cifras redondeadas: se informa, no hace fallar. */
  roundedRate: number | null;
  guardrailRate: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  ttftP50Ms: number | null;
  avgTokens: number | null;
  /** Requests al modelo (un paso = una request). */
  requests: number;
  costUsd: number | null;
  /** Reintentos por timeout del proveedor (corridas que se colgaron y se repitieron). */
  timeoutRetries: number;
  /** Tiempo de pared total de las preguntas, con reintentos; `null` si los resultados no lo traen. */
  wallMs: number | null;
  byCategory: Partial<Record<Category, { cases: number; passed: number }>>;
  /** Dev (ajuste del prompt) contra test (nunca vistas): la brecha mide el sobreajuste. */
  bySplit: Partial<Record<Split, { cases: number; passed: number }>>;
  /** Lo mismo por split, con pass^k y pass@k. */
  splitStats: Partial<Record<Split, PassSummary>>;
}

function passSummary(rows: readonly CaseResult[]): PassSummary {
  const outcomes = new Map<string, boolean[]>();
  for (const r of rows) {
    const list = outcomes.get(r.id) ?? [];
    list.push(r.score?.passed === true);
    outcomes.set(r.id, list);
  }
  const passed = rows.filter((r) => r.score?.passed).length;
  return {
    ...passStats(outcomes),
    n: rows.length,
    passed,
    passCI: wilsonInterval(passed, rows.length),
  };
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

  const bySplit: ModelSummary["bySplit"] = {};
  for (const r of own) {
    const current = bySplit[r.split] ?? { cases: 0, passed: 0 };
    bySplit[r.split] = {
      cases: current.cases + 1,
      passed: current.passed + (r.score?.passed ? 1 : 0),
    };
  }

  const splitStats: ModelSummary["splitStats"] = {};
  for (const split of ["dev", "test"] as const) {
    const rows = own.filter((r) => r.split === split);
    if (rows.length > 0) splitStats[split] = passSummary(rows);
  }
  const overall = passSummary(own);
  const hallucinated = scored.filter((r) => r.score!.hallucinated).length;
  const guardrailHits = guarded.filter((r) => r.score!.guardrailOk).length;

  return {
    model,
    mode: own[0]?.mode ?? null,
    runs: overall.k,
    distinctCases: overall.cases,
    overall,
    passCI: overall.passCI,
    hallucinationCI: wilsonInterval(hallucinated, scored.length),
    fabricationCI: wilsonInterval(
      scored.filter((r) => r.score!.fabricated).length,
      scored.length,
    ),
    guardrailCI: wilsonInterval(guardrailHits, guarded.length),
    hallucinationN: scored.length,
    guardrailN: guarded.length,
    splitStats,
    cases: own.length,
    passed: own.filter((r) => r.score?.passed).length,
    timeoutRetries: own.reduce((acc, r) => acc + (r.retries ?? 0), 0),
    wallMs: own.some((r) => r.wallMs !== undefined)
      ? own.reduce((acc, r) => acc + (r.wallMs ?? r.latencyMs), 0)
      : null,
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
    fabricationRate: share(
      scored.filter((r) => r.score!.fabricated).length,
      scored.length,
    ),
    roundedRate: share(
      scored.filter((r) => r.score!.rounded).length,
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
    bySplit,
  };
}

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(0)} %`;
const ci = (value: number | null, interval: Interval | null): string =>
  value === null || interval === null
    ? "—"
    : `${pct(value)} [${(interval.lo * 100).toFixed(0)}–${(interval.hi * 100).toFixed(0)}]`;
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
  meta: { date: string; cases: number; runs?: number; mode?: EvalMode },
): string {
  const runs = meta.runs ?? 1;
  const mode = meta.mode ?? "agent";
  const quality = [
    "| Modelo | n | pass@1 [IC 95 %] | pass^k | pass@k | Acierto numérico | Tool correcta | Alucinación (estricta) [IC 95 %] | Inventó cifras [IC 95 %] | Solo redondeó | Guardrails [IC 95 %] |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...summaries.map(
      (s) =>
        `| \`${s.model}\` | ${s.cases} | ${ci(s.passRate, s.passCI)} | ${pct(s.overall.passHatK)} | ${pct(s.overall.passAtK)} | ${pct(s.numericAccuracy)} | ${pct(s.toolAccuracy)} | ${ci(s.hallucinationRate, s.hallucinationCI)} | ${ci(s.fabricationRate, s.fabricationCI)} | ${pct(s.roundedRate)} | ${ci(s.guardrailRate, s.guardrailCI)} |`,
    ),
  ];
  const cost = [
    "| Modelo | Latencia p50 | p95 | Tokens/pregunta | Costo total | Reintentos por timeout | Tiempo total |",
    "|---|---|---|---|---|---|---|",
    ...summaries.map(
      (s) =>
        `| \`${s.model}\` | ${secs(s.latencyP50Ms)} | ${secs(s.latencyP95Ms)} | ${s.avgTokens === null ? "—" : Math.round(s.avgTokens).toLocaleString("es-UY")} | ${usd(s.costUsd)} | ${s.timeoutRetries} | ${secs(s.wallMs)} |`,
    ),
  ];
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
            return cell
              ? `${cell.passed}/${cell.cases} (n=${cell.cases}, ${pct(cell.passed / cell.cases)})`
              : "—";
          })
          .join(" | ")} |`,
    ),
  ];
  const splitCell = (s: ModelSummary, split: Split): string => {
    const cell = s.splitStats[split];
    return cell
      ? `n=${cell.n}: ${ci(cell.passAt1, cell.passCI)}; pass^k ${pct(cell.passHatK)}`
      : "—";
  };
  const bySplit = [
    "| Modelo | dev (ajuste) | test (sin ver) |",
    "|---|---|---|",
    ...summaries.map(
      (s) =>
        `| \`${s.model}\` | ${splitCell(s, "dev")} | ${splitCell(s, "test")} |`,
    ),
  ];
  return [
    `# Evals del asistente (${meta.date}, ${modeLabel(mode)}, k=${runs})`,
    "",
    `${meta.cases} preguntas × ${runs} ${runs === 1 ? "corrida" : "corridas"} sobre una cartera demo ficticia. La respuesta correcta de cada una la calcula el motor de la app; el modelo solo elige la tool y explica.${mode === "sin_tools" ? " **Ablación: el modelo no tiene ninguna tool y responde de memoria.**" : ""}`,
    "",
    "Alucinación (estricta): cualquier cifra que no aparece textual en las tools. Inventó cifras: las que ni siquiera son un número de las tools redondeado (sumas, estimaciones, inventos); eso hace fallar la pregunta. Solo redondeó: únicamente cifras de las tools con menos decimales (224 por 224,09); se informa pero no hace fallar.",
    "",
    "pass@1: promedio de aprobación sobre todas las corridas. pass^k: preguntas que aprueban en las k corridas. pass@k: preguntas que aprueban en al menos una. Los intervalos son de Wilson al 95 %, tratando cada pregunta-corrida como un ensayo independiente (no lo son del todo: con k > 1 son optimistas, y pass^k es la medida a nivel pregunta).",
    "",
    ...quality,
    "",
    ...cost,
    "",
    "## Por split",
    "",
    ...bySplit,
    "",
    "## Por categoría",
    "",
    "`n` es el número de preguntas-corrida: una categoría con n chico no dice mucho.",
    "",
    ...byCategory,
    "",
  ].join("\n");
}
