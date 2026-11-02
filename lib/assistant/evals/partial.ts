import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { EvalCase } from "./cases";
import type { CaseResult } from "./runner";

// Guardado incremental de los evals: cada pregunta-corrida se agrega a un `.partial.jsonl` apenas
// termina (una línea por resultado), así que cortar la corrida no pierde lo ya hecho y se puede
// reanudar saltando lo que ya está.

export const runKey = (model: string, id: string, run: number): string =>
  `${model}\u0000${id}\u0000${run}`;

export function appendPartial(path: string, result: CaseResult): void {
  appendFileSync(path, `${JSON.stringify(result)}\n`);
}

/** Resultados ya guardados; ignora una última línea cortada por un corte en medio de la escritura. */
export function loadPartial(path: string): CaseResult[] {
  if (!existsSync(path)) return [];
  const results: CaseResult[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      results.push(JSON.parse(line) as CaseResult);
    } catch {
      // línea incompleta: esa corrida se repite
    }
  }
  return results;
}

/**
 * Corre todas las combinaciones modelo × pregunta × corrida con `runOne`, guardando cada resultado
 * en `partialPath`. Las combinaciones ya presentes en el archivo no se vuelven a correr (los errores
 * de la API sí: no son una medida).
 */
export async function runAll(args: {
  models: readonly string[];
  cases: readonly EvalCase[];
  runs: number;
  partialPath: string;
  runOne: (
    model: string,
    evalCase: EvalCase,
    run: number,
  ) => Promise<CaseResult>;
  onResult?: (result: CaseResult, skipped: boolean) => void;
}): Promise<CaseResult[]> {
  const done = new Map<string, CaseResult>();
  for (const r of loadPartial(args.partialPath)) {
    if (r.error === null) done.set(runKey(r.model, r.id, r.run), r);
  }
  const results: CaseResult[] = [];
  for (const model of args.models) {
    for (const evalCase of args.cases) {
      for (let run = 0; run < args.runs; run++) {
        const previous = done.get(runKey(model, evalCase.id, run));
        if (previous) {
          results.push(previous);
          args.onResult?.(previous, true);
          continue;
        }
        const result = await args.runOne(model, evalCase, run);
        appendPartial(args.partialPath, result);
        results.push(result);
        args.onResult?.(result, false);
      }
    }
  }
  return results;
}
