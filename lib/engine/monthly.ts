import { addDays, addMonths, onOrBeforeWeekday } from "./dates";
import { ZERO, type Dec } from "./decimal";
import {
  closeOnOrBefore,
  sortCloses,
  type DailySeries,
  type SeriesPoint,
} from "./series";
import type { DailyClose } from "./valuation";

// Rendimiento por mes calendario del portafolio y del benchmark. Puro.

const ONE = ZERO.plus(1);

export interface MonthlyReturn {
  /** `YYYY-MM`: el mes de calendario de la rueda (hora de Nueva York). */
  month: string;
  /** TWR encadenado del mes (fracción); `null` si ningún día del mes tuvo base positiva. */
  portfolio: Dec | null;
  /** Cierre de fin de mes sobre el del mes anterior (ajustado por dividendos); `null` sin datos. */
  benchmark: Dec | null;
  /** Es el primer mes de la serie y arrancó antes de la primera operación: cuenta solo desde ahí. */
  startsMidMonth: boolean;
  /** Es el último mes de la serie y todavía no terminó. */
  inProgress: boolean;
}

/**
 * Un elemento por mes con días en la serie, en orden. El portafolio encadena `growth` de los días
 * del mes (los sin base no aportan). El benchmark compara el último cierre del mes con el último
 * del mes anterior; para el primer mes, el anterior es el cierre del día base de la serie, así los
 * dos rendimientos cuentan desde el mismo día.
 */
export function computeMonthlyReturns(
  series: DailySeries,
  benchmark: readonly DailyClose[] | null,
): MonthlyReturn[] {
  if (series.baseDate === null || series.points.length === 0) return [];
  const sorted =
    benchmark === null || benchmark.length === 0 ? null : sortCloses(benchmark);

  const months = new Map<string, SeriesPoint[]>();
  for (const point of series.points) {
    const key = point.date.slice(0, 7);
    const list = months.get(key);
    if (list) list.push(point);
    else months.set(key, [point]);
  }

  const result: MonthlyReturn[] = [];
  let previousEnd = series.baseDate;
  let position = 0;
  for (const [month, points] of months) {
    const last = points[points.length - 1]!;

    let product = ONE;
    let counted = 0;
    for (const point of points) {
      if (point.growth === null) continue;
      product = product.mul(point.growth);
      counted++;
    }

    result.push({
      month,
      portfolio: counted === 0 ? null : product.minus(1),
      benchmark: benchmarkReturn(sorted, previousEnd, last.date),
      startsMidMonth: position === 0 && series.baseDate.slice(0, 7) === month,
      inProgress:
        position === months.size - 1 && last.date < monthEndWeekday(month),
    });
    previousEnd = last.date;
    position++;
  }
  return result;
}

/** El último día hábil del mes `YYYY-MM`. */
function monthEndWeekday(month: string): string {
  return onOrBeforeWeekday(addDays(addMonths(`${month}-01`, 1), -1));
}

function benchmarkReturn(
  sorted: readonly DailyClose[] | null,
  from: string,
  to: string,
): Dec | null {
  if (sorted === null) return null;
  const start = closeOnOrBefore(sorted, from);
  const end = closeOnOrBefore(sorted, to);
  if (start === null || end === null || !start.close.gt(0)) return null;
  return end.close.div(start.close).minus(1);
}
