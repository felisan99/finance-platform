// Aligera la serie que viaja al cliente en el gráfico "Tus operaciones": diaria el último año y
// semanal antes. Es SOLO para mostrar, y puro (sin imports): lo prueba downsample.test.ts.

const DAY_MS = 86_400_000;

const dayNumber = (date: string): number =>
  Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

/**
 * Deja todos los puntos desde `dailyFrom` (inclusive) y, antes de esa fecha, el último punto de
 * cada semana (bloques de 7 días). Siempre conserva el primero, el último y los puntos cuya fecha
 * esté en `keepDates` (los días de las operaciones: los marcadores tienen que quedar exactos).
 * Espera la serie ordenada por fecha; el orden se mantiene.
 */
export function downsampleSeries<P extends { date: string }>(
  points: readonly P[],
  options: { dailyFrom: string; keepDates: ReadonlySet<string> },
): P[] {
  if (points.length <= 2) return [...points];
  const lastIndex = points.length - 1;
  const out: P[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const next = points[i + 1];
    const keep =
      i === 0 ||
      i === lastIndex ||
      point.date >= options.dailyFrom ||
      options.keepDates.has(point.date) ||
      // último punto de su semana: el siguiente ya cae en otro bloque
      (next !== undefined &&
        Math.floor(dayNumber(point.date) / 7) !==
          Math.floor(dayNumber(next.date) / 7));
    if (keep) out.push(point);
  }
  return out;
}
