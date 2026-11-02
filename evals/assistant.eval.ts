import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { expect, it } from "vitest";
import { MAX_STEPS } from "@/lib/assistant/agent";
import { getAssistantConfig } from "@/lib/assistant/config";
import { CASES, type EvalCase } from "@/lib/assistant/evals/cases";
import {
  estimateRequests,
  parseNoTools,
  parseRuns,
  parseSplit,
  selectCases,
} from "@/lib/assistant/evals/select";
import {
  evalSettings,
  sha256,
  toolDescriptionsHash,
  type EvalMode,
  type RunMetadata,
} from "@/lib/assistant/evals/metadata";
import { inMemoryStore } from "@/lib/assistant/fixture/demo-deps";
import { demoDataSource } from "@/lib/assistant/fixture/demo-data-source";
import { DEMO_NOW } from "@/lib/assistant/fixture/demo-portfolio";
import { markdownReport, summarizeModel } from "@/lib/assistant/evals/report";
import {
  RequestPacer,
  evalPrompt,
  evalTools,
  runCase,
  type CaseResult,
} from "@/lib/assistant/evals/runner";
import { runAll } from "@/lib/assistant/evals/partial";
import { createAssistantModel } from "@/lib/assistant/provider";

// Evals del asistente: `pnpm eval`. Gasta requests de OpenRouter (y créditos con modelos pagos).
//
//   EVAL_MODELS=a/b:free,c/d   modelos a comparar (por defecto, ASSISTANT_MODEL)
//   EVAL_CATEGORY=rendimiento  solo una categoría
//   EVAL_SPLIT=test            solo dev (ajuste del prompt) o test (nunca vistas al ajustar); por defecto, ambas
//   EVAL_IDS=pos-total,perf-1y solo esas preguntas
//   EVAL_LIMIT=5               solo las primeras N
//   EVAL_RUNS=3                corridas por pregunta y modelo (1 a 10; por defecto 1): habilita pass^k y pass@k
//   EVAL_NO_TOOLS=1            ablación: el mismo prompt y modelo sin ninguna tool (responde de memoria)
//   EVAL_STEP_TIMEOUT_MS=90000 corta un paso sin contenido nuevo por ese tiempo y reintenta la pregunta (0 = sin corte)
//   EVAL_RUN_DEADLINE_MS=180000 tope absoluto por intento de pregunta-corrida; al vencer se aborta y se reintenta
//   EVAL_RESUME=evals/results/<fecha>.partial.jsonl  reanuda una corrida cortada (salta lo ya hecho; mismos filtros)
//   EVAL_DRY_RUN=1             muestra cuántas requests gastaría, sin llamar a nadie
//
// Deja el detalle (con los datos para reproducir la corrida) en evals/results/<fecha>.json y la
// tabla en evals/results/<fecha>.md. Es una cartera ficticia: los resultados se pueden versionar.

const config = getAssistantConfig();

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function selectedCases(): EvalCase[] {
  return selectCases(CASES, {
    ids: process.env.EVAL_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    category: process.env.EVAL_CATEGORY?.trim(),
    split: process.env.EVAL_SPLIT,
    limit: Number(process.env.EVAL_LIMIT ?? "0"),
  });
}

it.skipIf(!config)("evals del asistente", async () => {
  const models = (process.env.EVAL_MODELS ?? config!.model)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const cases = selectedCases();
  const runs = parseRuns(process.env.EVAL_RUNS);
  const noTools = parseNoTools(process.env.EVAL_NO_TOOLS);
  const mode: EvalMode = noTools ? "sin_tools" : "agent";
  const estimate = estimateRequests({
    cases: cases.length,
    models: models.length,
    runs,
    noTools,
    maxSteps: MAX_STEPS,
  });
  console.info(
    `[eval] ${cases.length} preguntas (${cases.filter((c) => c.split === "dev").length} dev, ${cases.filter((c) => c.split === "test").length} test) × ${models.length} modelos × ${runs} ${runs === 1 ? "corrida" : "corridas"} (${mode === "agent" ? "agent" : "sin tools"}) ≈ ${estimate.expected} requests (máx. ${estimate.max})`,
  );
  if (process.env.EVAL_DRY_RUN) return;

  const dir = resolve(process.cwd(), "evals/results");
  mkdirSync(dir, { recursive: true });
  const resume = process.env.EVAL_RESUME?.trim();
  const date = resume
    ? basename(resume).replace(/\.partial\.jsonl$/, "")
    : new Date().toISOString().slice(0, 16).replace(":", "");
  const partialPath = resume
    ? resolve(process.cwd(), resume)
    : resolve(dir, `${date}.partial.jsonl`);
  const stepTimeoutMs = Number(process.env.EVAL_STEP_TIMEOUT_MS ?? "90000");
  const modelOf = new Map(
    models.map((modelId) => [
      modelId,
      {
        model: createAssistantModel({
          apiKey: config!.apiKey,
          model: modelId,
          // Sin respaldo: se mide el modelo tal cual.
          fallbackModels: [],
        }),
        pacer: new RequestPacer(modelId.endsWith(":free") ? 18 : 120),
      },
    ]),
  );
  const results: CaseResult[] = await runAll({
    models,
    cases,
    runs,
    partialPath,
    runOne: (modelId, evalCase, run) =>
      runCase({
        model: modelOf.get(modelId)!.model,
        modelId,
        evalCase,
        pacer: modelOf.get(modelId)!.pacer,
        maxStepsPerCase: 3,
        run,
        noTools,
        stepTimeoutMs: stepTimeoutMs > 0 ? stepTimeoutMs : undefined,
        runDeadlineMs: Number(process.env.EVAL_RUN_DEADLINE_MS ?? "180000"),
      }),
    onResult: (result, skipped) =>
      console.info(
        `[eval] ${result.model} ${result.id} #${result.run + 1}/${runs}: ${skipped ? "ya hecha" : (result.error ?? (result.score?.passed ? "ok" : "falla"))} (${result.tools.join(", ") || "sin tools"}, ${(result.latencyMs / 1000).toFixed(1)} s${result.retries ? `, ${result.retries} reintento(s) por timeout` : ""})`,
      ),
  });

  const ds = demoDataSource(DEMO_NOW);
  const metadata: RunMetadata = {
    date: new Date().toISOString(),
    commit: gitCommit(),
    mode,
    split: parseSplit(process.env.EVAL_SPLIT) ?? null,
    runs,
    modelsRequested: models,
    modelsServed: Object.fromEntries(
      models.map((m) => [
        m,
        [
          ...new Set(
            results.flatMap((r) =>
              r.model === m && r.servedModel ? [r.servedModel] : [],
            ),
          ),
        ],
      ]),
    ),
    systemPromptSha256: sha256(evalPrompt(ds.scopeName, mode)),
    // Las descripciones son las del agente completo, también en la ablación (que no las ofrece).
    toolDescriptionsSha256: toolDescriptionsHash(
      evalTools(ds, inMemoryStore(), []),
    ),
    settings: evalSettings(process.env),
  };

  const summaries = models.map((m) => summarizeModel(m, results));
  writeFileSync(
    resolve(dir, `${date}.json`),
    JSON.stringify({ date, metadata, models, summaries, results }, null, 2),
  );
  const report = markdownReport(summaries, {
    date,
    cases: cases.length,
    runs,
    mode,
  });
  writeFileSync(resolve(dir, `${date}.md`), report);
  console.info(report);
  expect(results.length).toBe(cases.length * models.length * runs);
});
