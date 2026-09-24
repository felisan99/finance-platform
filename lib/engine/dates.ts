import { formatInTimeZone } from "date-fns-tz";

// Fechas de calendario como strings `YYYY-MM-DD`, sin hora ni zona: la serie diaria del portafolio
// (spec §6.4) trabaja por día de mercado. La aritmética es en UTC a propósito: un día de calendario
// no tiene horario de verano. Nada acá lee el reloj.

const DAY_MS = 86_400_000;

/** Zona de la bolsa: el día de mercado de una operación es el de Nueva York (spec §6.7). */
const EXCHANGE_TZ = "America/New_York";

const parse = (key: string): Date => new Date(`${key}T00:00:00.000Z`);
const format = (date: Date): string => date.toISOString().slice(0, 10);

/** Fecha de la rueda (`YYYY-MM-DD`, hora de Nueva York) en la que cae un instante. */
export const marketDay = (instant: Date): string =>
  formatInTimeZone(instant, EXCHANGE_TZ, "yyyy-MM-dd");

export function addDays(key: string, days: number): string {
  return format(new Date(parse(key).getTime() + days * DAY_MS));
}

/**
 * Suma meses de calendario. Si el día no existe en el mes de destino queda en el último día de ese
 * mes (31/03 − 1 mes = 28/02), como hacen los calendarios.
 */
export function addMonths(key: string, months: number): string {
  const source = parse(key);
  const total = source.getUTCFullYear() * 12 + source.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return format(
    new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), lastDay))),
  );
}

/** Días de calendario de `from` a `to` (negativo si `to` es anterior). */
export const daysBetween = (from: string, to: string): number =>
  Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);

/** Lunes a viernes. Los feriados no se conocen: para eso está el "último cierre conocido". */
export function isWeekday(key: string): boolean {
  const day = parse(key).getUTCDay();
  return day >= 1 && day <= 5;
}

/** El primer día hábil desde `key` inclusive (un sábado pasa al lunes). */
export function onOrAfterWeekday(key: string): string {
  let current = key;
  while (!isWeekday(current)) current = addDays(current, 1);
  return current;
}

/** El último día hábil hasta `key` inclusive (un domingo vuelve al viernes). */
export function onOrBeforeWeekday(key: string): string {
  let current = key;
  while (!isWeekday(current)) current = addDays(current, -1);
  return current;
}

/** El día hábil inmediatamente anterior a `key` (estricto). */
export const previousWeekday = (key: string): string =>
  onOrBeforeWeekday(addDays(key, -1));

/** Todos los días hábiles de `from` a `to`, ambos incluidos y en orden. */
export function weekdaysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = onOrAfterWeekday(from); day <= to; day = addDays(day, 1)) {
    if (isWeekday(day)) days.push(day);
  }
  return days;
}

export const yearOf = (key: string): number => Number(key.slice(0, 4));
