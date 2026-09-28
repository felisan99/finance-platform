import {
  buildDailySeries,
  combineSeries,
  performanceOfSeries,
  type DailyClose,
  type PerformanceResult,
} from "@/lib/engine";
import { applyLiveQuotes, liveQuoteOf, type LiveQuote } from "./live-series";
import { buildPerformanceView, type PerformanceView } from "./performance-view";
import type { PortfolioSnapshot } from "./snapshot";

/** El día más reciente entre las series de cierres (YYYY-MM-DD), o `null` si no hay ninguna. */
function latestDate(
  ...lists: ReadonlyArray<readonly { date: string }[]>
): string | null {
  const dates = lists.flatMap((list) => list.at(-1)?.date ?? []);
  return dates.length === 0
    ? null
    : dates.reduce((max, date) => (date > max ? date : max));
}

/**
 * Del snapshot y los cierres leídos al rendimiento (sin tocar la base). Si "Actualizar precios"
 * trajo cotizaciones de un día más nuevo que el último cierre, la serie termina en ese día con la
 * cotización como último punto (`live-series.ts`): las cotizaciones son las mismas con las que
 * Inicio valúa cada posición (`snapshot.prices`), así el gráfico y las métricas cuentan lo mismo
 * que el valor total. `null` si no hay ningún cierre.
 */
export function assemblePerformance(input: {
  snapshot: PortfolioSnapshot;
  /** Cierres (`close`) por símbolo de todo lo que el libro alguna vez tuvo. */
  closes: ReadonlyMap<string, readonly DailyClose[]>;
  /** Cierres ajustados por dividendos (`adj_close`) del benchmark; vacío si no hay. */
  benchmarkCloses: readonly DailyClose[];
  benchmarkQuote: LiveQuote | null;
  benchmarkSymbol: string | null;
}): { result: PerformanceResult; view: PerformanceView } | null {
  const { snapshot, closes, benchmarkCloses } = input;

  const lastCloseDate = latestDate(...closes.values(), benchmarkCloses);
  if (lastCloseDate === null) return null;

  const quotes = new Map<string, LiveQuote>();
  for (const [symbol, price] of snapshot.prices) {
    const quote = liveQuoteOf(price);
    if (quote) quotes.set(symbol, quote);
  }
  const live = applyLiveQuotes({
    closes,
    quotes,
    benchmark: benchmarkCloses,
    benchmarkQuote: input.benchmarkQuote,
  });
  const endDate = latestDate(...live.closes.values(), live.benchmark);
  if (endDate === null) return null;

  const benchmark = live.benchmark.length > 0 ? live.benchmark : null;
  // Una serie por cuenta (el libro es por cuenta) y, con «Todo junto», su suma día por día.
  const series = combineSeries(
    snapshot.parts.map((part) =>
      buildDailySeries({
        transactions: part.transactions,
        closes: live.closes,
        endDate,
        options: { currency: part.portfolio.account.currency },
      }),
    ),
  );
  const result = performanceOfSeries(series, benchmark);
  const view = buildPerformanceView({
    result,
    benchmark,
    benchmarkSymbol: input.benchmarkSymbol,
    live:
      live.liveAsOf === null ? null : { asOf: live.liveAsOf, lastCloseDate },
  });
  return view ? { result, view } : null;
}
