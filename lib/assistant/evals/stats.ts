// Estadística de los evals: funciones puras, sin modelo ni red.

export interface Interval {
  lo: number;
  hi: number;
}

/**
 * Intervalo de Wilson al 95 % para una proporción. Cada par (pregunta, corrida) se trata como un
 * ensayo de Bernoulli independiente. No lo es del todo: las corridas de la misma pregunta están
 * correlacionadas (una pregunta difícil falla casi siempre), así que el intervalo es más angosto
 * de lo que debería cuando k > 1. Por eso el reporte también trae pass^k a nivel pregunta.
 */
export function wilsonInterval(
  hits: number,
  n: number,
  z = 1.96,
): Interval | null {
  if (n <= 0) return null;
  const p = hits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export interface PassStats {
  /** Preguntas distintas. */
  cases: number;
  /** Corridas por pregunta (el máximo observado). */
  k: number;
  /** Promedio de aprobación sobre todos los pares pregunta-corrida. */
  passAt1: number | null;
  /** Fracción de preguntas que aprueban en TODAS sus corridas (consistencia). */
  passHatK: number | null;
  /** Fracción de preguntas que aprueban en al menos una corrida. */
  passAtK: number | null;
}

/** `outcomes`: por pregunta, el aprobado de cada una de sus corridas. */
export function passStats(outcomes: ReadonlyMap<string, boolean[]>): PassStats {
  const lists = [...outcomes.values()].filter((l) => l.length > 0);
  if (lists.length === 0) {
    return { cases: 0, k: 0, passAt1: null, passHatK: null, passAtK: null };
  }
  const runs = lists.reduce((acc, l) => acc + l.length, 0);
  const passes = lists.reduce((acc, l) => acc + l.filter(Boolean).length, 0);
  return {
    cases: lists.length,
    k: Math.max(...lists.map((l) => l.length)),
    passAt1: passes / runs,
    passHatK: lists.filter((l) => l.every(Boolean)).length / lists.length,
    passAtK: lists.filter((l) => l.some(Boolean)).length / lists.length,
  };
}
