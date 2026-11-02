import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CASES } from "@/lib/assistant/evals/cases";
import { markdownReport } from "@/lib/assistant/evals/report";
import { rescoreResults, type SavedRun } from "@/lib/assistant/evals/rescore";
import { demoDataSource } from "@/lib/assistant/fixture/demo-data-source";
import { DEMO_NOW } from "@/lib/assistant/fixture/demo-portfolio";

// `EVAL_RESCORE_FILE=evals/results/<fecha>.json pnpm eval:rescore`: re-puntúa un resultado
// guardado con el puntuador actual. No llama a ningún modelo. Escribe <fecha>.rescored.md.
const file = process.env.EVAL_RESCORE_FILE;

describe.skipIf(!file)("re-puntuar un resultado guardado", () => {
  it("re-puntúa", async () => {
    const path = resolve(process.cwd(), file!);
    const saved = JSON.parse(readFileSync(path, "utf8")) as SavedRun & {
      date: string;
      metadata?: { runs?: number; mode?: "agent" | "sin_tools" };
    };
    const { results, summaries } = await rescoreResults(
      saved,
      CASES,
      demoDataSource(DEMO_NOW),
    );
    const report = markdownReport(summaries, {
      date: `${saved.date} (re-puntuado)`,
      cases: new Set(results.map((r) => r.id)).size,
      runs: saved.metadata?.runs ?? 1,
      mode: saved.metadata?.mode ?? "agent",
    });
    writeFileSync(path.replace(/\.json$/, ".rescored.md"), report);
    console.info(report);
    expect(results.length).toBe(saved.results.length);
  });
});
