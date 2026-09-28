import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import {
  addDays,
  addMonths,
  d,
  marketDay,
  type DailyClose,
} from "@/lib/engine";
import { buildBeforeBuyView, type BeforeBuyView } from "./before-buy-view";
import { getBenchmark, getCloseSeries } from "./queries";
import type { DailyCloseRow, InstrumentRow } from "./rows";
import type { PortfolioSnapshot } from "./snapshot";

/** El benchmark de quien todavía no tiene portafolio (el mismo que se crea por defecto). */
const DEFAULT_BENCHMARK = "SPY";
/** Años de la simulación de aportes más larga. */
const PLAN_YEARS = 5;
/** Cierres de antes del inicio: feriados y el día base. */
const MARGIN_DAYS = 10;

const toCloses = (rows: readonly DailyCloseRow[] | undefined): DailyClose[] =>
  (rows ?? []).map((row) => ({ date: row.date, close: d(row.value) }));

/** El sector de un instrumento, o "ETF" para un fondo (no traen sector). */
export const groupOfInstrument = (
  instrument: Pick<InstrumentRow, "type" | "sector">,
): string | null =>
  instrument.type === "ETF" ? "ETF" : instrument.sector?.trim() || null;

/**
 * Lee lo que necesita «Antes de comprar»: 5 años de cierres ajustados por dividendos del candidato
 * y del benchmark, y el último año de las posiciones abiertas. Sin llamadas a Yahoo: todo sale de
 * `prices_daily`. `null` si el candidato todavía no tiene cierres.
 */
export async function loadBeforeBuy(
  client: SupabaseClient<Database>,
  args: {
    snapshot: PortfolioSnapshot | null;
    instrument: InstrumentRow;
    now: Date;
  },
): Promise<BeforeBuyView | null> {
  const { snapshot, instrument } = args;
  const today = marketDay(args.now);

  const symbol = snapshot?.portfolio.benchmarkSymbol ?? DEFAULT_BENCHMARK;
  const benchmark = await getBenchmark(client, symbol);

  const held = (snapshot?.valued.positions ?? []).flatMap((position) => {
    if (!position.isOpen || position.marketValue === null) return [];
    const row = snapshot?.instrumentBySymbol.get(position.symbol);
    return row ? [row] : [];
  });

  const longIds = [
    instrument.id,
    ...(benchmark.instrumentId ? [benchmark.instrumentId] : []),
  ];
  const shortIds = held
    .map((row) => row.id)
    .filter((id) => !longIds.includes(id));

  const [long, short] = await Promise.all([
    getCloseSeries(
      client,
      [...new Set(longIds)],
      addDays(addMonths(today, -12 * PLAN_YEARS), -MARGIN_DAYS),
      "adj_close",
    ),
    getCloseSeries(
      client,
      shortIds,
      addDays(addMonths(today, -12), -MARGIN_DAYS),
      "adj_close",
    ),
  ]);
  const closesOf = (id: string) => toCloses(long.get(id) ?? short.get(id));

  const holdingCloses = new Map(
    held.map((row) => [row.symbol, closesOf(row.id)] as const),
  );
  const groups = new Map<string, string | null>(
    [...(snapshot?.instrumentBySymbol.values() ?? [])].map((row) => [
      row.symbol,
      groupOfInstrument(row),
    ]),
  );
  groups.set(instrument.symbol, groupOfInstrument(instrument));

  return buildBeforeBuyView({
    symbol: instrument.symbol,
    valued: snapshot?.valued ?? null,
    transactions: snapshot?.transactions ?? [],
    groupOf: (symbol) => groups.get(symbol) ?? null,
    candidateCloses: closesOf(instrument.id),
    holdingCloses,
    benchmark:
      benchmark.instrumentId != null
        ? { symbol: benchmark.symbol, closes: closesOf(benchmark.instrumentId) }
        : null,
    today,
  });
}
