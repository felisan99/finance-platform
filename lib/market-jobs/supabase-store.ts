import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/db/database.types";
import type {
  CorporateAction,
  DailyBar,
  InstrumentProfile,
  Quote,
} from "@/lib/market-data";
import {
  actionKey,
  type ActiveInstrument,
  type FinishRun,
  type JobName,
  type MarketStore,
  type StoredClose,
} from "./types";

type Client = SupabaseClient<Database>;

const UPSERT_CHUNK = 500;
const DELETE_CHUNK = 100;
const PAGE = 1000;

/** PostgREST devuelve errores como objetos sueltos: se convierten en Error con contexto. */
function fail(
  operation: string,
  error: { message: string; code?: string },
): never {
  throw new Error(
    `db ${operation}: ${error.message}${error.code ? ` (${error.code})` : ""}`,
  );
}

/**
 * Los montos viajan como strings decimales y se convierten a número recién acá, en el borde con
 * la base. Es lossless: tienen a lo sumo 10 dígitos significativos (un double da 15) y
 * `JSON.stringify` los serializa con su representación más corta ("1730.98").
 */
function num(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`monto inválido: ${value.slice(0, 30)}`);
  return parsed;
}

/** Copia serializable: garantiza que a `jsonb` van solo datos planos. */
const toJson = (value: unknown): Json =>
  JSON.parse(JSON.stringify(value)) as Json;

// El tipo generado de `active_instruments` marca todo como no nulo aunque no lo sea: se valida acá.
const activeRow = z.object({
  instrument_id: z.string(),
  symbol: z.string(),
  provider_symbol: z.string().nullable(),
  history_backfilled_at: z.string().nullable(),
  history_from: z.string().nullable(),
  first_tx_date: z.string().nullable(),
  in_watchlist: z.boolean(),
  latest_price_date: z.string().nullable(),
});

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    result.push(items.slice(i, i + size));
  return result;
}

/**
 * `MarketStore` sobre Supabase. Recibe el cliente con la clave secreta (`createAdminClient`,
 * que salta RLS): las tablas de mercado y `market_job_runs` solo las escribe el servidor.
 */
export function createSupabaseMarketStore(client: Client): MarketStore {
  return {
    async listActiveInstruments(): Promise<ActiveInstrument[]> {
      const { data, error } = await client.rpc("active_instruments");
      if (error) fail("active_instruments", error);
      const parsed = z.array(activeRow).safeParse(data);
      if (!parsed.success)
        throw new Error("db active_instruments: formato inesperado");
      return parsed.data.map((row) => ({
        id: row.instrument_id,
        symbol: row.symbol,
        providerSymbol: row.provider_symbol,
        historyBackfilledAt: row.history_backfilled_at,
        historyFrom: row.history_from,
        firstTxDate: row.first_tx_date,
        inWatchlist: row.in_watchlist,
        latestPriceDate: row.latest_price_date,
      }));
    },

    async getStoredCloses(instrumentId, from): Promise<StoredClose[]> {
      const { data, error } = await client
        .from("prices_daily")
        .select("date, close")
        .eq("instrument_id", instrumentId)
        .gte("date", from)
        .order("date");
      if (error) fail("getStoredCloses", error);
      return data.map((row) => ({ date: row.date, close: String(row.close) }));
    },

    async getStoredActionKeys(instrumentId): Promise<Set<string>> {
      const { data, error } = await client
        .from("corporate_actions")
        .select("type, ex_date")
        .eq("instrument_id", instrumentId);
      if (error) fail("getStoredActionKeys", error);
      return new Set(
        data.map((row) =>
          actionKey({
            type: row.type as CorporateAction["type"],
            exDate: row.ex_date,
          }),
        ),
      );
    },

    async upsertPrices(instrumentId, bars: DailyBar[]) {
      for (const batch of chunks(bars, UPSERT_CHUNK)) {
        const { error } = await client.from("prices_daily").upsert(
          batch.map((bar) => ({
            instrument_id: instrumentId,
            date: bar.date,
            close: num(bar.close),
            adj_close: bar.adjClose === null ? null : num(bar.adjClose),
          })),
          { onConflict: "instrument_id,date" },
        );
        if (error) fail("upsertPrices", error);
      }
    },

    async pruneStalePrices(instrumentId, from, keepDates): Promise<number> {
      const keep = new Set(keepDates);
      const stale: string[] = [];
      // Se lee por páginas: PostgREST corta las respuestas en 1000 filas.
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await client
          .from("prices_daily")
          .select("date")
          .eq("instrument_id", instrumentId)
          .gte("date", from)
          .order("date")
          .range(offset, offset + PAGE - 1);
        if (error) fail("pruneStalePrices", error);
        for (const row of data) if (!keep.has(row.date)) stale.push(row.date);
        if (data.length < PAGE) break;
      }
      // Lo normal es que no haya nada para borrar: en ese caso no hay más consultas.
      for (const batch of chunks(stale, DELETE_CHUNK)) {
        const { error } = await client
          .from("prices_daily")
          .delete()
          .eq("instrument_id", instrumentId)
          .in("date", batch);
        if (error) fail("pruneStalePrices", error);
      }
      return stale.length;
    },

    async upsertCorporateActions(instrumentId, actions: CorporateAction[]) {
      if (actions.length === 0) return;
      const { error } = await client.from("corporate_actions").upsert(
        actions.map((action) => ({
          instrument_id: instrumentId,
          type: action.type,
          ex_date: action.exDate,
          ratio: action.type === "SPLIT" ? num(action.ratio) : null,
          amount: action.type === "DIVIDEND" ? num(action.amount) : null,
        })),
        { onConflict: "instrument_id,type,ex_date" },
      );
      if (error) fail("upsertCorporateActions", error);
    },

    async upsertQuotes(rows: Array<{ instrumentId: string; quote: Quote }>) {
      if (rows.length === 0) return;
      const { error } = await client.from("quotes_latest").upsert(
        rows.map(({ instrumentId, quote }) => ({
          instrument_id: instrumentId,
          price: num(quote.price),
          change: quote.change === null ? null : num(quote.change),
          change_pct: quote.changePct === null ? null : num(quote.changePct),
          as_of: quote.asOf.toISOString(),
        })),
        { onConflict: "instrument_id" },
      );
      if (error) fail("upsertQuotes", error);
    },

    async markBackfilled(instrumentId, { at, from }) {
      const { error } = await client
        .from("instruments")
        .update({ history_backfilled_at: at.toISOString(), history_from: from })
        .eq("id", instrumentId);
      if (error) fail("markBackfilled", error);
    },

    async markNeedsBackfill(instrumentId) {
      const { error } = await client
        .from("instruments")
        .update({ history_backfilled_at: null })
        .eq("id", instrumentId);
      if (error) fail("markNeedsBackfill", error);
    },

    async fillProfileGaps(instrumentId, profile: InstrumentProfile) {
      const { data: current, error } = await client
        .from("instruments")
        .select("name, type, exchange, sector, industry")
        .eq("id", instrumentId)
        .single();
      if (error) fail("fillProfileGaps", error);

      const patch: Database["public"]["Tables"]["instruments"]["Update"] = {};
      if (current.name === null && profile.name !== null)
        patch.name = profile.name;
      if (current.type === null && profile.type !== null)
        patch.type = profile.type;
      if (current.exchange === null && profile.exchange !== null)
        patch.exchange = profile.exchange;
      if (current.sector === null && profile.sector !== null)
        patch.sector = profile.sector;
      if (current.industry === null && profile.industry !== null)
        patch.industry = profile.industry;
      if (Object.keys(patch).length === 0) return;

      const { error: updateError } = await client
        .from("instruments")
        .update(patch)
        .eq("id", instrumentId);
      if (updateError) fail("fillProfileGaps", updateError);
    },

    async startRun(job: JobName, startedAt: Date): Promise<string> {
      const { data, error } = await client
        .from("market_job_runs")
        .insert({ job, started_at: startedAt.toISOString(), status: "running" })
        .select("id")
        .single();
      if (error) fail("startRun", error);
      return data.id;
    },

    async finishRun(runId, result: FinishRun) {
      const { error } = await client
        .from("market_job_runs")
        .update({
          status: result.status,
          finished_at: result.finishedAt.toISOString(),
          summary: toJson(result.summary),
          errors: toJson(result.issues),
        })
        .eq("id", runId);
      if (error) fail("finishRun", error);
    },

    async failStaleRuns(startedBefore, now): Promise<number> {
      const { data, error } = await client
        .from("market_job_runs")
        .update({
          status: "error",
          finished_at: now.toISOString(),
          errors: toJson([
            {
              stage: "run",
              message: "la corrida no llegó a cerrarse (¿se cortó la función?)",
            },
          ]),
        })
        .eq("status", "running")
        .lt("started_at", startedBefore.toISOString())
        .select("id");
      if (error) fail("failStaleRuns", error);
      return data.length;
    },
  };
}
