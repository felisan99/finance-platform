import type { EvalCase, Split } from "./cases";

// Filtros de `pnpm eval` (variables de entorno), aparte del script para poder probarlos.

export interface CaseFilters {
  ids?: readonly string[];
  category?: string;
  split?: string;
  limit?: number;
}

export function parseSplit(value: string | undefined): Split | undefined {
  const split = value?.trim();
  if (!split) return undefined;
  if (split === "dev" || split === "test") return split;
  throw new Error(`EVAL_SPLIT inválido: "${split}" (usá dev o test)`);
}

export function selectCases(
  cases: readonly EvalCase[],
  filters: CaseFilters,
): EvalCase[] {
  let selected = [...cases];
  if (filters.ids?.length)
    selected = selected.filter((c) => filters.ids!.includes(c.id));
  if (filters.category)
    selected = selected.filter((c) => c.category === filters.category);
  const split = parseSplit(filters.split);
  if (split) selected = selected.filter((c) => c.split === split);
  return filters.limit && filters.limit > 0
    ? selected.slice(0, filters.limit)
    : selected;
}

export const MAX_RUNS = 10;

/** `EVAL_RUNS`: corridas por pregunta y modelo (entero entre 1 y 10; vacío = 1). */
export function parseRuns(value: string | undefined): number {
  const text = value?.trim();
  if (!text) return 1;
  const runs = Number(text);
  if (!/^\d+$/.test(text) || runs < 1 || runs > MAX_RUNS) {
    throw new Error(
      `EVAL_RUNS inválido: "${text}" (entero de 1 a ${MAX_RUNS})`,
    );
  }
  return runs;
}

/** `EVAL_NO_TOOLS`: "1" o "true" activan la ablación sin tools; vacío, "0" o "false" no. */
export function parseNoTools(value: string | undefined): boolean {
  const text = value?.trim().toLowerCase();
  if (!text || text === "0" || text === "false") return false;
  if (text === "1" || text === "true") return true;
  throw new Error(`EVAL_NO_TOOLS inválido: "${value}" (usá 1 o 0)`);
}

/**
 * Requests que gastaría una corrida. Con tools, ~2,5 pasos por pregunta en promedio y `maxSteps`
 * de tope; sin tools, el modelo responde en un solo paso.
 */
export function estimateRequests(args: {
  cases: number;
  models: number;
  runs: number;
  noTools: boolean;
  maxSteps: number;
}): { expected: number; max: number } {
  const pairs = args.cases * args.models * args.runs;
  return args.noTools
    ? { expected: pairs, max: pairs }
    : { expected: Math.round(pairs * 2.5), max: pairs * args.maxSteps };
}
