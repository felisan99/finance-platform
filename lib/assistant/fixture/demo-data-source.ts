import { addDays, addMonths, marketDay, type DailyClose } from "@/lib/engine";
import { groupOfInstrument } from "@/lib/portfolio/before-buy-data";
import { buildBeforeBuyView } from "@/lib/portfolio/before-buy-view";
import { assemblePerformance } from "@/lib/portfolio/performance-build";
import {
  scopeName,
  type PortfolioScope,
} from "@/lib/portfolio/portfolio-scope";
import { buildSnapshot } from "@/lib/portfolio/snapshot";
import { once, type AssistantDataSource } from "../data-source";
import {
  DEMO_CLOSES,
  DEMO_CLOSES_ROWS,
  DEMO_INSTRUMENTS,
  DEMO_NOW,
  DEMO_PORTFOLIO,
  DEMO_TRANSACTION_ROWS,
} from "./demo-portfolio";

/**
 * La cartera demo servida desde memoria, con las mismas funciones puras que usa la app al leer de
 * Supabase (`buildSnapshot`, `assemblePerformance`, `buildBeforeBuyView`). Así los evals y los
 * tests corren el código de producción sin tocar la base.
 */
export function demoDataSource(now: Date = DEMO_NOW): AssistantDataSource {
  const scope: PortfolioScope = { kind: "one", portfolio: DEMO_PORTFOLIO };
  const today = marketDay(now);
  const closesUntilToday = (symbol: string): DailyClose[] =>
    (DEMO_CLOSES.get(symbol) ?? []).filter((c) => c.date <= today);

  const snapshot = once(async () =>
    buildSnapshot({
      scope,
      parts: [
        { portfolio: DEMO_PORTFOLIO, transactionRows: DEMO_TRANSACTION_ROWS },
      ],
      instruments: DEMO_INSTRUMENTS,
      quotes: [],
      closes: DEMO_CLOSES_ROWS,
    }),
  );

  const performance = once(async () => {
    const snap = await snapshot();
    const closes = new Map<string, DailyClose[]>();
    for (const row of snap.instrumentById.values()) {
      closes.set(row.symbol, closesUntilToday(row.symbol));
    }
    return assemblePerformance({
      snapshot: snap,
      closes,
      benchmarkCloses: closesUntilToday(snap.benchmarkSymbol),
      benchmarkQuote: null,
      benchmarkSymbol: snap.benchmarkSymbol,
    });
  });

  return {
    now,
    scopeName: scopeName(scope),
    snapshot,
    performance,
    async priceHistory(symbol, from) {
      const instrument = DEMO_INSTRUMENTS.find((i) => i.symbol === symbol);
      if (!instrument) return null;
      return {
        symbol,
        name: instrument.name,
        closes: closesUntilToday(symbol).filter((c) => c.date >= from),
      };
    },
    async beforeBuy(symbol) {
      const instrument = DEMO_INSTRUMENTS.find((i) => i.symbol === symbol);
      if (!instrument) return null;
      const snap = await snapshot();
      const since = (months: number) => addDays(addMonths(today, -months), -10);
      const holdingCloses = new Map(
        snap.valued.positions
          .filter((p) => p.isOpen && p.marketValue !== null)
          .map((p) => [
            p.symbol,
            closesUntilToday(p.symbol).filter((c) => c.date >= since(12)),
          ]),
      );
      const groups = new Map(
        DEMO_INSTRUMENTS.map((row) => [row.symbol, groupOfInstrument(row)]),
      );
      return buildBeforeBuyView({
        symbol,
        valued: snap.valued,
        transactions: snap.transactions,
        groupOf: (s) => groups.get(s) ?? null,
        candidateCloses: closesUntilToday(symbol).filter(
          (c) => c.date >= since(60),
        ),
        holdingCloses,
        benchmark: {
          symbol: snap.benchmarkSymbol,
          closes: closesUntilToday(snap.benchmarkSymbol).filter(
            (c) => c.date >= since(60),
          ),
        },
        today,
      });
    },
  };
}
