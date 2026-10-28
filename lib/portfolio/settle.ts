/**
 * Convierte una lectura compartida en una promesa que nunca rechaza: si falla, deja el detalle en
 * `console.error` y resuelve `null`. Así no hay rechazo sin manejar mientras nadie la espera y cada
 * sección decide cómo degradar en vez de tirar abajo la página.
 */
export function settle<T>(
  promise: Promise<T>,
  label: string,
): Promise<T | null> {
  return promise.then(
    (value) => value,
    (error: unknown) => {
      console.error(
        `[${label}]`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    },
  );
}
