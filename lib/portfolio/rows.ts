import { z } from "zod";

// Filas tal como llegan de la base (PostgREST) y su validación en el borde. Los `numeric` se
// piden como texto (`columna::text`) y entran al motor con `d()`: no pasan por floats.

export const TX_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "DEPOSIT",
  "WITHDRAWAL",
  "FEE",
  "INTEREST",
  "SPLIT",
  "TAX",
] as const;
export type TxTypeName = (typeof TX_TYPES)[number];

export const TRANSACTION_COLUMNS =
  "id, type, instrument_id, executed_at, quantity::text, price::text, amount::text, fee::text, currency, split_ratio::text, notes, source, external_id, created_at, seq";

export const transactionRowSchema = z.object({
  id: z.string(),
  type: z.enum(TX_TYPES),
  instrument_id: z.string().nullable(),
  executed_at: z.string(),
  quantity: z.string().nullable(),
  price: z.string().nullable(),
  amount: z.string().nullable(),
  fee: z.string(),
  currency: z.string(),
  split_ratio: z.string().nullable(),
  notes: z.string().nullable(),
  source: z.string(),
  external_id: z.string().nullable(),
  created_at: z.string(),
  seq: z.number(),
});
export type TransactionRow = z.infer<typeof transactionRowSchema>;

export const INSTRUMENT_COLUMNS =
  "id, symbol, name, type, exchange, sector, provider_symbol";

export const instrumentRowSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  name: z.string().nullable(),
  type: z.string().nullable(),
  exchange: z.string().nullable(),
  sector: z.string().nullable(),
  provider_symbol: z.string().nullable(),
});
export type InstrumentRow = z.infer<typeof instrumentRowSchema>;

export const QUOTE_COLUMNS = "instrument_id, price::text, change::text, as_of";

export const quoteRowSchema = z.object({
  instrument_id: z.string(),
  price: z.string(),
  change: z.string().nullable(),
  as_of: z.string(),
});
export type QuoteRow = z.infer<typeof quoteRowSchema>;

/** Resultado del RPC `instrument_prices`. */
export const closesRowSchema = z.object({
  instrument_id: z.string(),
  last_close: z.string(),
  last_date: z.string(),
  prev_close: z.string().nullable(),
  prev_date: z.string().nullable(),
});
export type ClosesRow = z.infer<typeof closesRowSchema>;

export const accountRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.string(),
  cost_method: z.string(),
});
export type AccountRow = z.infer<typeof accountRowSchema>;

/** Valida filas del borde con la base; un formato inesperado es un error, no un dato "raro". */
export function parseRows<T>(
  schema: z.ZodType<T>,
  data: unknown,
  what: string,
): T[] {
  const parsed = z.array(schema).safeParse(data);
  if (!parsed.success) throw new Error(`db ${what}: formato inesperado`);
  return parsed.data;
}

/** Un cierre diario tal como lo devuelve la base: la fecha y un `numeric` como texto. */
export const dailyCloseRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.string(),
});
export type DailyCloseRow = z.infer<typeof dailyCloseRowSchema>;

export const benchmarkRowSchema = z.object({
  portfolios: z.object({ benchmark_symbol: z.string() }).nullable(),
});

/** Un símbolo seguido, con su instrumento embebido (`watchlist_items` → `instruments`). */
export const watchlistItemRowSchema = z.object({
  added_at: z.string(),
  instruments: instrumentRowSchema,
});
export type WatchlistItemRow = z.infer<typeof watchlistItemRowSchema>;

/** Resultado del RPC `watchlist_market`: `recent` son pares `[fecha, cierre]` de más viejo a más nuevo. */
export const watchlistMarketRowSchema = z.object({
  instrument_id: z.string(),
  last_close: z.string(),
  last_date: z.string(),
  prev_close: z.string().nullable(),
  prev_date: z.string().nullable(),
  low_close: z.string().nullable(),
  high_close: z.string().nullable(),
  recent: z.array(z.tuple([z.string(), z.string()])).nullable(),
});
export type WatchlistMarketRow = z.infer<typeof watchlistMarketRowSchema>;
