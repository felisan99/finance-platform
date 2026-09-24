// Fechas como strings YYYY-MM-DD en UTC: son las que guarda la base (columnas `date`).

export const isoDate = (instant: Date): string =>
  instant.toISOString().slice(0, 10);

export const startOfDay = (date: string): Date =>
  new Date(`${date}T00:00:00.000Z`);

export function addDays(date: string, days: number): string {
  const result = startOfDay(date);
  result.setUTCDate(result.getUTCDate() + days);
  return isoDate(result);
}

export function addYears(date: string, years: number): string {
  const result = startOfDay(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return isoDate(result);
}
