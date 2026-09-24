import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Zona horaria de la UI (spec §6.7). Todo se guarda en UTC; acá se muestra y se interpreta lo que
 * escribe el usuario. Uruguay no usa horario de verano desde 2015 (UTC−3 fijo).
 */
export const APP_TZ = "America/Montevideo";

export const formatLocal = (instant: Date, pattern: string): string =>
  formatInTimeZone(instant, APP_TZ, pattern);

/** Fecha local (YYYY-MM-DD): agrupa operaciones por día en la UI. */
export const localDateKey = (instant: Date): string =>
  formatLocal(instant, "yyyy-MM-dd");

export const localYear = (instant: Date): number =>
  Number(formatLocal(instant, "yyyy"));

/** Valor para un `<input type="datetime-local">`: `YYYY-MM-DDTHH:mm` en hora de Montevideo. */
export const toLocalInput = (instant: Date): string =>
  formatLocal(instant, "yyyy-MM-dd'T'HH:mm");

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Lo que escribe el usuario en `datetime-local` (hora de Montevideo) → instante UTC. Devuelve
 * `null` si el formato o la fecha no son válidos (por ejemplo, el 31 de febrero).
 */
export function parseLocalInput(text: string): Date | null {
  const trimmed = text.trim();
  if (!LOCAL_INPUT.test(trimmed)) return null;
  const instant = fromZonedTime(trimmed, APP_TZ);
  if (Number.isNaN(instant.getTime())) return null;
  // Ida y vuelta: descarta fechas que el motor de fechas "corrige" en silencio.
  return toLocalInput(instant) === trimmed.slice(0, 16) ? instant : null;
}
