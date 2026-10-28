import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { MAX_STEPS } from "@/lib/assistant/agent";
import { getAssistantConfig } from "@/lib/assistant/config";
import { CASES, type EvalCase } from "@/lib/assistant/evals/cases";
import { markdownReport, summarizeModel } from "@/lib/assistant/evals/report";
import {
  RequestPacer,
  runCase,
  type CaseResult,
} from "@/lib/assistant/evals/runner";
import { createAssistantModel } from "@/lib/assistant/provider";

// Evals del asistente: `pnpm eval`. Gasta requests de OpenRouter (y créditos con modelos pagos).
//
//   EVAL_MODELS=a/b:free,c/d   modelos a comparar (por defecto, ASSISTANT_MODEL)
//   EVAL_CATEGORY=rendimiento  solo una categoría
//   EVAL_IDS=pos-total,perf-1y solo esas preguntas
//   EVAL_LIMIT=5               solo las primeras N
//   EVAL_DRY_RUN=1             muestra cuántas requests gastaría, sin llamar a nadie
//
// Deja el detalle en evals/results/<fecha>.json y la tabla en evals/results/<fecha>.md.

const config = getAssistantConfig();

function selectedCases(): EvalCase[] {
  const ids = process.env.EVAL_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const category = process.env.EVAL_CATEGORY?.trim();
  const limit = Number(process.env.EVAL_LIMIT ?? "0");
  let cases = CASES;
  if (ids?.length) cases = cases.filter((c) => ids.includes(c.id));
  if (category) cases = cases.filter((c) => c.category === category);
  return limit > 0 ? cases.slice(0, limit) : cases;
}

it.skipIf(!config)("evals del asistente", async () => {
  const models = (process.env.EVAL_MODELS ?? config!.model)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const cases = selectedCases();
  // ~2,5 pasos por pregunta en promedio; el tope es MAX_STEPS.
  console.info(
    `[eval] ${cases.length} preguntas × ${models.length} modelos ≈ ${Math.round(cases.length * models.length * 2.5)} requests (máx. ${cases.length * models.length * MAX_STEPS})`,
  );
  if (process.env.EVAL_DRY_RUN) return;

  const results: CaseResult[] = [];
  for (const modelId of models) {
    const model = createAssistantModel({
      apiKey: config!.apiKey,
      model: modelId,
      // Sin respaldo: se mide el modelo tal cual.
      fallbackModels: [],
    });
    const pacer = new RequestPacer(modelId.endsWith(":free") ? 18 : 120);
    for (const evalCase of cases) {
      const result = await runCase({
        model,
        modelId,
        evalCase,
        pacer,
        maxStepsPerCase: 3,
      });
      results.push(result);
      console.info(
        `[eval] ${modelId} ${evalCase.id}: ${result.error ?? (result.score?.passed ? "ok" : "falla")} (${result.tools.join(", ") || "sin tools"}, ${(result.latencyMs / 1000).toFixed(1)} s)`,
      );
    }
  }

  const date = new Date().toISOString().slice(0, 16).replace(":", "");
  const summaries = models.map((m) => summarizeModel(m, results));
  const dir = resolve(process.cwd(), "evals/results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, `${date}.json`),
    JSON.stringify({ date, models, summaries, results }, null, 2),
  );
  const report = markdownReport(summaries, { date, cases: cases.length });
  writeFileSync(resolve(dir, `${date}.md`), report);
  console.info(report);
  expect(results.length).toBe(cases.length * models.length);
});
