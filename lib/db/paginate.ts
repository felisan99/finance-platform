/**
 * PostgREST corta cada respuesta en 1000 filas (`max-rows`) SIN avisar: un `select` sin paginar de
 * una serie de 5 años (~1260 filas) devuelve las primeras 1000 y el resto se pierde en silencio, y
 * un `.limit(5000)` no lo evita (docs/decisions.md, observación 9). Toda lectura que pueda pasar de
 * eso se hace con `fetchAllPages`.
 */
export const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Lee todas las filas de una consulta paginando con `range(from, to)`. `fetchPage` arma la consulta
 * (con un orden estable: sin él las páginas pueden repetir o saltear filas) y devuelve la página
 * pedida. Se detiene cuando llega una página incompleta.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const { pageSize = PAGE_SIZE, maxRows = 200_000 } = options;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`db: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    // Tope de seguridad contra un bucle si la consulta ignorara el rango.
    if (rows.length >= maxRows) {
      throw new Error("db: la consulta devolvió demasiadas filas");
    }
  }
}

/** Parte una lista en grupos de a lo sumo `size` (para `.in(...)`: una URL muy larga se rechaza). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    groups.push(items.slice(i, i + size));
  return groups;
}
