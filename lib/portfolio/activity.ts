import { normalizeSymbol, SYMBOL_PATTERN } from "@/lib/validation/transaction";
import { localDateKey, parseLocalInput } from "./time";
import { TX_TYPES, type TransactionRow, type TxTypeName } from "./rows";

export const ACTIVITY_PAGE_SIZE = 50;
const MAX_PAGE = 10_000;

export interface ActivityFilters {
  type: TxTypeName | null;
  symbol: string | null;
  /** Fechas locales (YYYY-MM-DD), ambas incluidas. */
  from: string | null;
  to: string | null;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` real (no 2026-02-31) o `null`. */
function dateKey(value: string | undefined): string | null {
  if (!value || !DATE_KEY.test(value)) return null;
  const at = parseLocalInput(`${value}T12:00`);
  return at && localDateKey(at) === value ? value : null;
}

/**
 * Filtros de Actividad desde los parámetros de la URL. Todo lo que no sea válido se ignora (no
 * es un error: la URL la pudo escribir cualquiera); nada de esto llega a la base sin pasar por acá.
 */
export function parseActivityFilters(params: Params): ActivityFilters {
  const rawType = first(params.tipo);
  const type = TX_TYPES.find((t) => t === rawType) ?? null;

  const rawSymbol = first(params.simbolo);
  const symbol = rawSymbol ? normalizeSymbol(rawSymbol) : null;

  let from = dateKey(first(params.desde));
  let to = dateKey(first(params.hasta));
  if (from && to && from > to) [from, to] = [to, from];

  const rawPage = Number(first(params.pagina) ?? "0");
  const page =
    Number.isInteger(rawPage) && rawPage >= 0 && rawPage <= MAX_PAGE
      ? rawPage
      : 0;

  return {
    type,
    symbol:
      symbol && symbol.length <= 15 && SYMBOL_PATTERN.test(symbol)
        ? symbol
        : null,
    from,
    to,
    page,
  };
}

/** Rango UTC `[gte, lt)` de un rango de fechas locales (los extremos son días completos). */
export function localRangeToUtc(
  from: string | null,
  to: string | null,
): { gte: string | null; lt: string | null } {
  const start = from ? parseLocalInput(`${from}T00:00`) : null;
  let end: Date | null = null;
  if (to) {
    // Comienzo del día siguiente: el `hasta` incluye todo su día.
    const [y, m, d] = to.split("-").map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    end = parseLocalInput(`${next}T00:00`);
  }
  return { gte: start?.toISOString() ?? null, lt: end?.toISOString() ?? null };
}

/** Query string para los enlaces de paginación y de filtros (solo lo que tiene valor). */
export function activityQuery(filters: Partial<ActivityFilters>): string {
  const query = new URLSearchParams();
  if (filters.type) query.set("tipo", filters.type);
  if (filters.symbol) query.set("simbolo", filters.symbol);
  if (filters.from) query.set("desde", filters.from);
  if (filters.to) query.set("hasta", filters.to);
  if (filters.page) query.set("pagina", String(filters.page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** Agrupa filas (ya ordenadas de la más reciente a la más antigua) por día local, conservando el orden. */
export function groupByDay<T extends Pick<TransactionRow, "executed_at">>(
  rows: readonly T[],
): Array<{ dayKey: string; rows: T[] }> {
  const groups: Array<{ dayKey: string; rows: T[] }> = [];
  for (const row of rows) {
    const dayKey = localDateKey(new Date(row.executed_at));
    const last = groups.at(-1);
    if (last && last.dayKey === dayKey) last.rows.push(row);
    else groups.push({ dayKey, rows: [row] });
  }
  return groups;
}
