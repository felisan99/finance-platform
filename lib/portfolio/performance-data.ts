import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { addDays, d, type DailyClose } from "@/lib/engine";
import { describeError } from "@/lib/market-data";
import {
  assemblePerformance,
  type AssembledPerformance,
} from "./performance-build";
import type { PerformanceView } from "./performance-view";
import { getBenchmark, getCloseSeries, getQuoteRows } from "./queries";
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
 * disponible o, si "Actualizar precios" trajo cotizaciones de un día más nuevo, en ese día con la
 * cotización como último punto (`live-series.ts`): así el gráfico y las métricas cuentan lo mismo
 * que el valor total de Inicio. `null` si no hay operaciones o ningún precio todavía.
 */
export async function loadPerformance(
  client: SupabaseClient<Database>,
  snapshot: PortfolioSnapshot,
): Promise<PerformanceView | null> {
  return (await loadPerformanceData(client, snapshot))?.view ?? null;
}

/**
 * Lo mismo que `loadPerformance`, pero con el resultado del motor y los cierres usados: el
 * asistente trabaja con los valores exactos (rangos libres, contribución) y no con el texto.
 */
export async function loadPerformanceData(
  client: SupabaseClient<Database>,
  snapshot: PortfolioSnapshot,
): Promise<AssembledPerformance | null> {
  if (snapshot.transactions.length === 0) return null;

  const firstTx = snapshot.transactions.reduce(
    (min, tx) => (tx.executedAt < min ? tx.executedAt : min),
    snapshot.transactions[0]!.executedAt,
  );
  const fromDate = addDays(firstTx.toISOString().slice(0, 10), -MARGIN_DAYS);

  const heldIds = [...snapshot.instrumentById.keys()];
  // Los cierres de lo que se tuvo no dependen del benchmark: se leen mientras se lo busca.
  const [held, { benchmark, benchmarkRows, benchmarkQuotes }] =
    await Promise.all([
      getCloseSeries(client, heldIds, fromDate, "close"),
      getBenchmark(client, snapshot.benchmarkSymbol).then(async (benchmark) => {
        const [benchmarkRows, benchmarkQuotes] = await Promise.all([
          benchmark.instrumentId
            ? getCloseSeries(
                client,
                [benchmark.instrumentId],
                fromDate,
                "adj_close",
              )
            : new Map<string, DailyCloseRow[]>(),
          benchmark.instrumentId
            ? getQuoteRows(client, [benchmark.instrumentId])
            : [],
        ]);
        return { benchmark, benchmarkRows, benchmarkQuotes };
      }),
    ]);

  const closes = new Map<string, DailyClose[]>();
  for (const [id, rows] of held) {
    const symbol = snapshot.instrumentById.get(id)?.symbol;
    if (symbol) closes.set(symbol, toCloses(rows));
  }
  const benchmarkCloses = benchmark.instrumentId
    ? toCloses(benchmarkRows.get(benchmark.instrumentId) ?? [])
    : [];

  return assemblePerformance({
    snapshot,
    closes,
    benchmarkCloses,
    benchmarkQuote: benchmarkQuotes[0]
      ? {
          price: d(benchmarkQuotes[0].price),
          asOf: new Date(benchmarkQuotes[0].as_of),
        }
      : null,
    benchmarkSymbol: benchmark?.symbol ?? null,
  });
}

/** Lo que salió de pedir el rendimiento, para que varias secciones de Inicio lo compartan. */
export type PerformanceOutcome =
  | { status: "ok"; view: PerformanceView }
  | { status: "empty" }
  | { status: "error" };

/**
 * `loadPerformance` sin excepciones: la promesa nunca se rechaza, así se puede empezar a leer antes
 * de renderizar y pasársela a varias secciones (cada una en su `<Suspense>`) sin que un fallo
 * tumbe el resto de Inicio ni quede una promesa rechazada sin atender.
 */
export async function loadPerformanceOutcome(
  client: SupabaseClient<Database>,
  snapshot: PortfolioSnapshot,
): Promise<PerformanceOutcome> {
  try {
    const view = await loadPerformance(client, snapshot);
    return view ? { status: "ok", view } : { status: "empty" };
  } catch (error) {
    console.error("[performance]", describeError(error));
    return { status: "error" };
  }
}
