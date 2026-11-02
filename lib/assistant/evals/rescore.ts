import type { EvalCase } from "./cases";
import { summarizeModel, type ModelSummary } from "./report";
import type { CaseResult } from "./runner";
import { scoreCase, type ToolCallRecord } from "./score";

// Re-puntúa un JSON guardado con el puntuador actual, sin llamar a modelos ni volver a ejecutar
// tools. Los JSON viejos (sin `calls`) se re-puntúan con los nombres de las tools y salidas
// vacías: sirve para la parte que no depende de las cifras, pero marca de más las inventadas.

export interface SavedRun {
  models: string[];
  results: CaseResult[];
}

export async function rescoreResults(
  saved: SavedRun,
  cases: readonly EvalCase[],
  demoDs: Parameters<EvalCase["expect"]>[0],
): Promise<{ results: CaseResult[]; summaries: ModelSummary[] }> {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const results: CaseResult[] = [];
  for (const r of saved.results) {
    const evalCase = byId.get(r.id);
    if (r.score === null || evalCase === undefined) {
      results.push(r);
      continue;
    }
    const calls: ToolCallRecord[] =
      r.calls ?? r.tools.map((name) => ({ name, input: null, output: null }));
    const score = scoreCase(r.question, await evalCase.expect(demoDs), {
      text: r.text,
      calls,
      memories: r.memories ?? [],
    });
    results.push({ ...r, score });
  }
  const models = saved.models ?? [...new Set(results.map((r) => r.model))];
  return {
    results,
    summaries: models.map((m) => summarizeModel(m, results)),
  };
}
