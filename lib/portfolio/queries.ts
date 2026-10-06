import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/db/database.types";
import { chunk, fetchAllPages } from "@/lib/db/paginate";
import {
  ACTIVITY_PAGE_SIZE,
  localRangeToUtc,
  type ActivityFilters,
} from "./activity";
import {
  portfoliosOfScope,
  type PortfolioRef,
  type PortfolioScope,
} from "./portfolio-scope";
import { buildSnapshot, type PortfolioSnapshot } from "./snapshot";
import {
  INSTRUMENT_COLUMNS,
  QUOTE_COLUMNS,
  TRANSACTION_COLUMNS,
  accountTransactionRowSchema,
  portfolioRowSchema,
  closesRowSchema,
  priceSeriesRowSchema,
  instrumentRowSchema,
  parseRows,
  quoteRowSchema,
  recentImportRowSchema,
  transactionRowSchema,
  watchlistItemRowSchema,
  watchlistMarketRowSchema,
  type ClosesRow,
  type DailyCloseRow,
  type InstrumentRow,
  type QuoteRow,
  type RecentImportRow,
  type AccountTransactionRow,
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

/**
 * Los portafolios de la persona (RLS), del más viejo al más nuevo, cada uno con su cuenta (la más
 * vieja, si por algún motivo tuviera más de una). Un portafolio sin cuenta no se muestra.
 */
export async function listPortfolios(client: Client): Promise<PortfolioRef[]> {
  const { data, error } = await loose(client)
    .from("portfolios")
    .select(
      "id, name, benchmark_symbol, accounts(id, name, currency, cost_method, created_at)",
    )
    .order("created_at")
    .order("id")
    .order("created_at", { referencedTable: "accounts" })
    .order("id", { referencedTable: "accounts" });
  if (error) throw new Error(`db portfolios: ${error.message}`);
  return toPortfolioRefs(data);
}

/**
 * Filas de `portfolios` con sus cuentas, ya ordenadas, a `PortfolioRef`: cada portafolio con su
 * cuenta más vieja; uno sin cuenta no se muestra. También lo usa el widget (`widget_ledger`).
 */
export function toPortfolioRefs(data: unknown): PortfolioRef[] {
  return parseRows(portfolioRowSchema, data, "portfolios").flatMap((row) => {
    const account = row.accounts[0];
    return account
      ? [
          {
            id: row.id,
            name: row.name,
            benchmarkSymbol: row.benchmark_symbol,
            account: {
              id: account.id,
              name: account.name,
              currency: account.currency,
              cost_method: account.cost_method,
            },
          },
        ]
      : [];
  });
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

/** Cuántas transacciones tiene una cuenta (RLS: solo si es del usuario). */
export async function countTransactions(
  client: Client,
  accountId: string,
): Promise<number> {
  const { count, error } = await loose(client)
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (error) throw new Error(`db transactions: ${error.message}`);
  return count ?? 0;
}

/** Las últimas importaciones del usuario (RLS), con cuántas transacciones les quedan ligadas hoy. */
export async function getRecentImports(
  client: Client,
  limit = 10,
): Promise<RecentImportRow[]> {
  const { data, error } = await client.rpc("recent_imports", {
    p_limit: limit,
  });
  if (error) throw new Error(`db recent_imports: ${error.message}`);
  return parseRows(recentImportRowSchema, data, "recent_imports");
}

/** Ids de las transacciones que quedaron ligadas a una importación (RLS: solo las del usuario). */
export async function getTransactionIdsByImport(
  client: Client,
  importId: string,
): Promise<string[]> {
  const rows = await fetchAllPages((from, to) =>
    loose(client)
      .from("transactions")
      .select("id")
      .eq("import_id", importId)
      .order("seq")
      .range(from, to),
  );
  return parseRows(z.object({ id: z.string() }), rows, "transactions").map(
    (row) => row.id,
  );
}

/** Una transacción por id (RLS: solo si es del usuario) con la cuenta a la que pertenece, o `null`. */
export async function getTransactionRow(
  client: Client,
  id: string,
): Promise<{ row: TransactionRow; accountId: string } | null> {
  const { data, error } = await loose(client)
    .from("transactions")
    .select(`${TRANSACTION_COLUMNS}, account_id`)
    .eq("id", id)
    .limit(1);
  if (error) throw new Error(`db transactions: ${error.message}`);
  const found = parseRows(accountTransactionRowSchema, data, "transactions")[0];
  if (!found) return null;
  const { account_id: accountId, ...row } = found;
  return { row, accountId };
}

/** La cuenta de una importación (RLS: solo si es del usuario); `null` si no existe o ya no tiene cuenta. */
export async function getImportAccountId(
  client: Client,
  importId: string,
): Promise<string | null> {
  const { data, error } = await loose(client)
    .from("imports")
    .select("account_id")
    .eq("id", importId)
    .limit(1);
  if (error) throw new Error(`db imports: ${error.message}`);
  const row = parseRows(
    z.object({ account_id: z.string().nullable() }),
    data,
    "imports",
  )[0];
  return row?.account_id ?? null;
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

/** El instrumento con ese símbolo, si ya está en la base (es una tabla compartida de solo lectura). */
export async function getInstrumentBySymbol(
  client: Client,
  symbol: string,
): Promise<InstrumentRow | null> {
  const { data, error } = await loose(client)
    .from("instruments")
    .select(INSTRUMENT_COLUMNS)
    .eq("symbol", symbol)
    .maybeSingle();
  if (error) throw new Error(`db instruments: ${error.message}`);
  if (data === null) return null;
  return parseRows(instrumentRowSchema, [data], "instruments")[0] ?? null;
}

/**
 * El símbolo con el que el proveedor conoce a uno que ya está en la base, si tiene uno propio
 * (`provider_symbol`); `null` si no está o usa el mismo.
 */
export async function getProviderSymbol(
  client: Client,
  symbol: string,
): Promise<string | null> {
  const { data, error } = await loose(client)
    .from("instruments")
    .select("provider_symbol")
    .eq("symbol", symbol)
    .maybeSingle();
  if (error) throw new Error(`db instruments: ${error.message}`);
  const row = data as { provider_symbol: string | null } | null;
  return row?.provider_symbol ?? null;
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

/** El benchmark de un portafolio (`SPY` por defecto) y su instrumento, si ya existe. */
export async function getBenchmark(
  client: Client,
  symbol: string,
): Promise<{ symbol: string; instrumentId: string | null }> {
  const ids = await getInstrumentIdsBySymbol(client, [symbol]);
  return { symbol, instrumentId: ids.get(symbol) ?? null };
}

/** La fila del instrumento de un benchmark (con su símbolo del proveedor), o `null` si no existe. */
export async function getBenchmarkInstrument(
  client: Client,
  symbol: string,
): Promise<InstrumentRow | null> {
  return getInstrumentBySymbol(client, symbol);
}

/** Instrumentos por llamada al RPC `price_series` (una fila por instrumento: no llega a las 1000). */
const PRICE_SERIES_CHUNK = 50;

/**
 * Cierres diarios (`close` o `adj_close`) de varios instrumentos desde `fromDate`, con el RPC
 * `price_series`: una llamada cada 50 instrumentos en vez de una consulta paginada por cada uno.
 * Los instrumentos sin filas quedan con una lista vacía.
 */
export async function getCloseSeries(
  client: Client,
  instrumentIds: readonly string[],
  fromDate: string,
  column: "close" | "adj_close",
): Promise<Map<string, DailyCloseRow[]>> {
  const unique = [...new Set(instrumentIds)];
  const result = new Map<string, DailyCloseRow[]>(unique.map((id) => [id, []]));
  const groups = await Promise.all(
    chunk(unique, PRICE_SERIES_CHUNK).map(async (group) => {
      const { data, error } = await client.rpc("price_series", {
        p_instrument_ids: group,
        p_from: fromDate,
        p_adjusted: column === "adj_close",
      });
      if (error) throw new Error(`db price_series: ${error.message}`);
      return parseRows(priceSeriesRowSchema, data, "price_series");
    }),
  );
  for (const row of groups.flat()) {
    if (!result.has(row.instrument_id)) continue;
    result.set(
      row.instrument_id,
      row.dates.map((date, i) => ({ date, value: row.closes[i]! })),
    );
  }
  return result;
}

/**
 * Carga todo lo que necesitan Inicio y Posiciones de un alcance (un portafolio, o todos con «Todo
 * junto»): las transacciones de cada cuenta, los instrumentos, las cotizaciones y los últimos
 * cierres. Las lecturas son independientes entre sí y van en paralelo.
 */
export async function loadScopeSnapshot(
  client: Client,
  scope: PortfolioScope,
): Promise<PortfolioSnapshot> {
  const portfolios = portfoliosOfScope(scope);
  const rowsByPortfolio = await Promise.all(
    portfolios.map((portfolio) =>
      getTransactionRows(client, portfolio.account.id),
    ),
  );
  return snapshotFromRows(client, scope, rowsByPortfolio);
}

/**
 * El snapshot a partir de las transacciones de cada portafolio del alcance (en el orden de
 * `portfoliosOfScope`): lee los instrumentos, las cotizaciones y los últimos cierres, que son datos
 * de mercado y no de una persona. Lo comparten Inicio y el widget.
 */
export async function snapshotFromRows(
  client: Client,
  scope: PortfolioScope,
  rowsByPortfolio: ReadonlyArray<readonly TransactionRow[]>,
): Promise<PortfolioSnapshot> {
  const portfolios = portfoliosOfScope(scope);
  const ids = [
    ...new Set(
      rowsByPortfolio
        .flat()
        .flatMap((r) => (r.instrument_id ? [r.instrument_id] : [])),
    ),
  ];

  const [instruments, quotes, closes] = await Promise.all([
    getInstruments(client, ids),
    getQuoteRows(client, ids),
    getCloseRows(client, ids),
  ]);

  return buildSnapshot({
    scope,
    parts: portfolios.map((portfolio, i) => ({
      portfolio,
      transactionRows: rowsByPortfolio[i] ?? [],
    })),
    instruments,
    quotes,
    closes,
  });
}

/** El snapshot de un solo portafolio. */
export const loadPortfolioSnapshot = (
  client: Client,
  portfolio: PortfolioRef,
): Promise<PortfolioSnapshot> =>
  loadScopeSnapshot(client, { kind: "one", portfolio });

/**
 * Una página de Actividad: de la más reciente a la más antigua, con filtros. Pide una fila de más
 * para saber si hay página siguiente sin contar toda la tabla. Un símbolo que no existe da una
 * página vacía.
 */
export async function getActivityPage(
  client: Client,
  accountIds: readonly string[],
  filters: ActivityFilters,
): Promise<{ rows: AccountTransactionRow[]; hasNext: boolean }> {
  if (accountIds.length === 0) return { rows: [], hasNext: false };
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
    .select(`${TRANSACTION_COLUMNS}, account_id`)
    .in("account_id", [...accountIds]);
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

  const rows = parseRows(accountTransactionRowSchema, data, "transactions");
  return {
    rows: rows.slice(0, ACTIVITY_PAGE_SIZE),
    hasNext: rows.length > ACTIVITY_PAGE_SIZE,
  };
}
