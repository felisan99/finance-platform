// Cuándo el widget vuelve a pedir una cotización (docs/decisions.md, "Widget de iPhone"). Puro.

/** Una cotización pedida hace menos de esto se usa tal cual. */
export const QUOTE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/** Lo que espera el widget a Yahoo antes de mostrar lo guardado. */
export const QUOTE_REFRESH_TIMEOUT_MS = 5_000;

/**
 * Los instrumentos cuya cotización hay que pedir: los que no tienen, o la pidieron hace
 * `QUOTE_MAX_AGE_MS` o más (`fetchedAt` = cuándo la pedimos, no la hora del mercado).
 */
export function staleQuoteIds(
  ids: readonly string[],
  fetchedAt: ReadonlyMap<string, Date | null>,
  now: Date,
  maxAgeMs: number = QUOTE_MAX_AGE_MS,
): string[] {
  return [...new Set(ids)].filter((id) => {
    const at = fetchedAt.get(id);
    return !at || now.getTime() - at.getTime() >= maxAgeMs;
  });
}

/** `null` si la promesa no termina en `ms` (la promesa sigue su curso; su error no se pierde suelto). */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
