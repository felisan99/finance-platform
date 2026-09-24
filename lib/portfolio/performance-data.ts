import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { addDays, computePerformance, d, type DailyClose } from "@/lib/engine";
import { buildPerformanceView, type PerformanceView } from "./performance-view";
import { getBenchmark, getCloseSeries } from "./queries";
import type { DailyCloseRow } from "./rows";
import type { PortfolioSnapshot } from "./snapshot";

/** Cierres previos a la primera operación: el día base y los feriados de antes. */
const MARGIN_DAYS = 10;

const toCloses = (rows: readonly DailyCloseRow[]): DailyClose[] =>
  rows.map((row) => ({ date: row.date, close: d(row.value) }));

/**
 * Lee los cierres de todo lo que el libro alguna vez tuvo (posiciones abiertas y cerradas) y del
 * benchmark, y calcula el rendimiento. Es la única parte de la Fase 5 que toca la base: el cálculo
 * está en `lib/engine` y el formato en `performance-view.ts`. La serie termina en el último cierre
 * disponible. `null` si no hay operaciones o ningún precio todavía.
 */
export async function loadPerformance(
  client: SupabaseClient<Database>,
  snapshot: PortfolioSnapshot,
): Promise<PerformanceView | null> {
  if (snapshot.transactions.length === 0) return null;

  const firstTx = snapshot.transactions.reduce(
    (min, tx) => (tx.executedAt < min ? tx.executedAt : min),
    snapshot.transactions[0]!.executedAt,
  );
  const fromDate = addDays(firstTx.toISOString().slice(0, 10), -MARGIN_DAYS);

  const heldIds = [...snapshot.instrumentById.keys()];
  const benchmark = await getBenchmark(client, snapshot.account.id);
  const [held, benchmarkRows] = await Promise.all([
    getCloseSeries(client, heldIds, fromDate, "close"),
    benchmark?.instrumentId
      ? getCloseSeries(client, [benchmark.instrumentId], fromDate, "adj_close")
      : Promise.resolve(new Map<string, DailyCloseRow[]>()),
  ]);

  const closes = new Map<string, DailyClose[]>();
  for (const [id, rows] of held) {
    const symbol = snapshot.instrumentById.get(id)?.symbol;
    if (symbol) closes.set(symbol, toCloses(rows));
  }
  const benchmarkCloses = benchmark?.instrumentId
    ? toCloses(benchmarkRows.get(benchmark.instrumentId) ?? [])
    : [];

  const lastDates = [
    ...[...closes.values()].map((list) => list.at(-1)?.date),
    benchmarkCloses.at(-1)?.date,
  ].filter((date): date is string => date !== undefined);
  if (lastDates.length === 0) return null;
  const endDate = lastDates.reduce((max, date) => (date > max ? date : max));

  const result = computePerformance({
    transactions: snapshot.transactions,
    closes,
    benchmark: benchmarkCloses.length > 0 ? benchmarkCloses : null,
    endDate,
    options: { currency: snapshot.account.currency },
  });
  return buildPerformanceView({
    result,
    benchmark: benchmarkCloses.length > 0 ? benchmarkCloses : null,
    benchmarkSymbol: benchmark?.symbol ?? null,
  });
}
