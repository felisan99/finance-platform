import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { chunk, fetchAllPages } from "@/lib/db/paginate";
import {
  ACTIVITY_PAGE_SIZE,
  localRangeToUtc,
  type ActivityFilters,
} from "./activity";
import { buildSnapshot, type PortfolioSnapshot } from "./snapshot";
import {
  INSTRUMENT_COLUMNS,
  QUOTE_COLUMNS,
  TRANSACTION_COLUMNS,
  accountRowSchema,
  benchmarkRowSchema,
  closesRowSchema,
  dailyCloseRowSchema,
  instrumentRowSchema,
  parseRows,
  quoteRowSchema,
  transactionRowSchema,
  watchlistItemRowSchema,
  watchlistMarketRowSchema,
  type AccountRow,
  type ClosesRow,
  type DailyCloseRow,
  type InstrumentRow,
  type QuoteRow,
  type TransactionRow,
  type WatchlistItemRow,
  type WatchlistMarketRow,
} from "./rows";

// Consultas de las pantallas. Se hacen con el cliente del usuario (RLS): nunca con la clave secreta.
// Los `numeric` se piden como texto (`col::text`); lo que vuelve se valida con Zod en el borde. El
// cliente se usa sin tipos de columna a propósito: el parser de tipos de supabase-js no sigue bien
// las selecciones con casts, y `parseRows` ya garantiza la forma de cada fila.

type Client = SupabaseClient<Database>;
const loose = (client: Client) => client as unknown as SupabaseClient;

/** Los `.in(...)` se parten: una lista larga de UUID pasa el límite de la URL. */
const IN_CHUNK = 100;

export async function getPrimaryAccount(
  client: Client,
): Promise<AccountRow | null> {
  const { data, error } = await loose(client)
    .from("accounts")
    .select("id, name, currency, cost_method")
    .order("created_at")
    .limit(1);
  if (error) throw new Error(`db accounts: ${error.message}`);
  return parseRows(accountRowSchema, data, "accounts")[0] ?? null;
}

/** Todas las transacciones de la cuenta, en el orden que espera el motor: `(executed_at, created_at, seq)`. */
export async function getTransactionRows(
  client: Client,
  accountId: string,
): Promise<TransactionRow[]> {
  const rows = await fetchAllPages((from, to) =>
    loose(client)
      .from("transactions")
      .select(TRANSACTION_COLUMNS)
      .eq("account_id", accountId)
      .order("executed_at")
      .order("created_at")
      .order("seq")
      .range(from, to),
  );
  return parseRows(transactionRowSchema, rows, "transactions");
}

/** Una transacción por id (RLS: solo si es del usuario), o `null`. */
export async function getTransactionRow(
  client: Client,
  id: string,
): Promise<TransactionRow | null> {
  const { data, error } = await loose(client)
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(`db transactions: ${error.message}`);
  return parseRows(transactionRowSchema, data, "transactions")[0] ?? null;
}

export async function getInstruments(
  client: Client,
  ids: readonly string[],
): Promise<InstrumentRow[]> {
  const rows: unknown[] = [];
  for (const group of chunk(ids, IN_CHUNK)) {
    const { data, error } = await loose(client)
      .from("instruments")
      .select(INSTRUMENT_COLUMNS)
      .in("id", group);
    if (error) throw new Error(`db instruments: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return parseRows(instrumentRowSchema, rows, "instruments");
}

/** Ids de los símbolos indicados que ya existen en `instruments` (`símbolo → id`). */
export async function getInstrumentIdsBySymbol(
  client: Client,
  symbols: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const group of chunk(symbols, IN_CHUNK)) {
    const { data, error } = await loose(client)
      .from("instruments")
      .select("id, symbol")
      .in("symbol", group);
    if (error) throw new Error(`db instruments: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; symbol: string }>) {
      found.set(row.symbol, row.id);
    }
  }
  return found;
}

export async function getQuoteRows(
  client: Client,
  ids: readonly string[],
): Promise<QuoteRow[]> {
  const rows: unknown[] = [];
  for (const group of chunk(ids, IN_CHUNK)) {
    const { data, error } = await loose(client)
      .from("quotes_latest")
      .select(QUOTE_COLUMNS)
      .in("instrument_id", group);
    if (error) throw new Error(`db quotes_latest: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return parseRows(quoteRowSchema, rows, "quotes_latest");
}

/** Último y penúltimo cierre por instrumento (RPC `instrument_prices`, hasta 500 por llamada). */
export async function getCloseRows(
  client: Client,
  ids: readonly string[],
): Promise<ClosesRow[]> {
  const rows: unknown[] = [];
  for (const group of chunk(ids, 500)) {
    const { data, error } = await client.rpc("instrument_prices", {
      p_instrument_ids: group,
    });
    if (error) throw new Error(`db instrument_prices: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return parseRows(closesRowSchema, rows, "instrument_prices");
}

/** Los símbolos que sigue la persona (RLS: solo los suyos), con su instrumento. */
export async function getWatchlistItems(
  client: Client,
): Promise<WatchlistItemRow[]> {
  const { data, error } = await loose(client)
    .from("watchlist_items")
    .select(`added_at, instruments(${INSTRUMENT_COLUMNS})`)
    .order("added_at");
  if (error) throw new Error(`db watchlist_items: ${error.message}`);
  return parseRows(watchlistItemRowSchema, data, "watchlist_items");
}

/** Id de la watchlist de la persona (la crea el alta de usuario); `null` si no tiene ninguna. */
export async function getWatchlistId(client: Client): Promise<string | null> {
  const { data, error } = await loose(client)
    .from("watchlists")
    .select("id")
    .limit(1);
  if (error) throw new Error(`db watchlists: ${error.message}`);
  const row = (data ?? [])[0] as { id?: unknown } | undefined;
  return typeof row?.id === "string" ? row.id : null;
}

/** Cantidad máxima de instrumentos por llamada al RPC `watchlist_market`. */
const WATCHLIST_MARKET_CHUNK = 100;

/**
 * Último y penúltimo cierre, rango de cierres desde `since` y los últimos `points` cierres de cada
 * instrumento (RPC `watchlist_market`). Los que no tienen ningún cierre no vuelven.
 */
export async function getWatchlistMarket(
  client: Client,
  ids: readonly string[],
  since: string,
  points: number,
): Promise<WatchlistMarketRow[]> {
  const rows: unknown[] = [];
  for (const group of chunk(ids, WATCHLIST_MARKET_CHUNK)) {
    const { data, error } = await client.rpc("watchlist_market", {
      p_instrument_ids: group,
      p_since: since,
      p_points: points,
    });
    if (error) throw new Error(`db watchlist_market: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return parseRows(watchlistMarketRowSchema, rows, "watchlist_market");
}

/** Serie diaria de cierres de un instrumento desde `fromDate` (YYYY-MM-DD), paginada. */
export async function getPriceSeries(
  client: Client,
  instrumentId: string,
  fromDate: string,
): Promise<Array<{ date: string; close: string }>> {
  const rows = await fetchAllPages((from, to) =>
    loose(client)
      .from("prices_daily")
      .select("date, close::text")
      .eq("instrument_id", instrumentId)
      .gte("date", fromDate)
      .order("date")
      .range(from, to),
  );
  return rows.map((row) => {
    const { date, close } = row as { date: string; close: string };
    return { date, close };
  });
}

/** El benchmark del portafolio de la cuenta (`SPY` por defecto) y su instrumento, si existe. */
export async function getBenchmark(
  client: Client,
  accountId: string,
): Promise<{ symbol: string; instrumentId: string | null } | null> {
  const { data, error } = await loose(client)
    .from("accounts")
    .select("portfolios(benchmark_symbol)")
    .eq("id", accountId)
    .limit(1);
  if (error) throw new Error(`db accounts: ${error.message}`);
  const row = parseRows(benchmarkRowSchema, data, "accounts")[0];
  const symbol = row?.portfolios?.benchmark_symbol;
  if (!symbol) return null;
  const ids = await getInstrumentIdsBySymbol(client, [symbol]);
  return { symbol, instrumentId: ids.get(symbol) ?? null };
}

/** Cuántos instrumentos se leen a la vez: una consulta paginada por cada uno. */
const SERIES_CONCURRENCY = 6;

/**
 * Cierres diarios (`close` o `adj_close`) de varios instrumentos desde `fromDate`. Cada serie se
 * pagina (PostgREST corta en 1000 filas); los instrumentos se leen en paralelo, de a pocos. Los
 * instrumentos sin filas quedan con una lista vacía.
 */
export async function getCloseSeries(
  client: Client,
  instrumentIds: readonly string[],
  fromDate: string,
  column: "close" | "adj_close",
): Promise<Map<string, DailyCloseRow[]>> {
  const result = new Map<string, DailyCloseRow[]>();
  for (const group of chunk(instrumentIds, SERIES_CONCURRENCY)) {
    await Promise.all(
      group.map(async (instrumentId) => {
        const rows = await fetchAllPages((from, to) => {
          let query = loose(client)
            .from("prices_daily")
            .select(`date, value:${column}::text`)
            .eq("instrument_id", instrumentId)
            .gte("date", fromDate);
          if (column === "adj_close")
            query = query.not("adj_close", "is", null);
          return query.order("date").range(from, to);
        });
        result.set(
          instrumentId,
          parseRows(dailyCloseRowSchema, rows, "prices_daily"),
        );
      }),
    );
  }
  return result;
}

/**
 * Carga todo lo que necesitan Inicio y Posiciones: la cuenta, sus transacciones, los instrumentos,
 * las cotizaciones y los últimos cierres. Devuelve `null` si el usuario todavía no tiene cuenta.
 * Las lecturas son independientes entre sí y van en paralelo.
 */
export async function loadPortfolioSnapshot(
  client: Client,
): Promise<PortfolioSnapshot | null> {
  const account = await getPrimaryAccount(client);
  if (!account) return null;

  const transactionRows = await getTransactionRows(client, account.id);
  const ids = [
    ...new Set(
      transactionRows.flatMap((r) =>
        r.instrument_id ? [r.instrument_id] : [],
      ),
    ),
  ];

  const [instruments, quotes, closes] = await Promise.all([
    getInstruments(client, ids),
    getQuoteRows(client, ids),
    getCloseRows(client, ids),
  ]);

  return buildSnapshot({
    account,
    transactionRows,
    instruments,
    quotes,
    closes,
  });
}

/**
 * Una página de Actividad: de la más reciente a la más antigua, con filtros. Pide una fila de más
 * para saber si hay página siguiente sin contar toda la tabla. Un símbolo que no existe da una
 * página vacía.
 */
export async function getActivityPage(
  client: Client,
  accountId: string,
  filters: ActivityFilters,
): Promise<{ rows: TransactionRow[]; hasNext: boolean }> {
  let instrumentId: string | null = null;
  if (filters.symbol) {
    instrumentId =
      (await getInstrumentIdsBySymbol(client, [filters.symbol])).get(
        filters.symbol,
      ) ?? null;
    if (!instrumentId) return { rows: [], hasNext: false };
  }

  let query = loose(client)
    .from("transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("account_id", accountId);
  if (filters.type) query = query.eq("type", filters.type);
  if (instrumentId) query = query.eq("instrument_id", instrumentId);
  const range = localRangeToUtc(filters.from, filters.to);
  if (range.gte) query = query.gte("executed_at", range.gte);
  if (range.lt) query = query.lt("executed_at", range.lt);

  const start = filters.page * ACTIVITY_PAGE_SIZE;
  const { data, error } = await query
    .order("executed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("seq", { ascending: false })
    .range(start, start + ACTIVITY_PAGE_SIZE);
  if (error) throw new Error(`db transactions: ${error.message}`);

  const rows = parseRows(transactionRowSchema, data, "transactions");
  return {
    rows: rows.slice(0, ACTIVITY_PAGE_SIZE),
    hasNext: rows.length > ACTIVITY_PAGE_SIZE,
  };
}
