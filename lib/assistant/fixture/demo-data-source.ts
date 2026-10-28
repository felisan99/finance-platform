import { addDays, addMonths, marketDay, type DailyClose } from "@/lib/engine";
import type { CompanyData } from "@/lib/market-data";
import { groupOfInstrument } from "@/lib/portfolio/before-buy-data";
import { buildBeforeBuyView } from "@/lib/portfolio/before-buy-view";
import { assemblePerformance } from "@/lib/portfolio/performance-build";
import {
  scopeName,
  type PortfolioScope,
} from "@/lib/portfolio/portfolio-scope";
import { buildSnapshot } from "@/lib/portfolio/snapshot";
import { once, type AssetInfo, type AssistantDataSource } from "../data-source";
import {
  DEMO_CLOSES,
  DEMO_CLOSES_ROWS,
  DEMO_INSTRUMENTS,
  DEMO_NOW,
  DEMO_PORTFOLIO,
  DEMO_TRANSACTION_ROWS,
} from "./demo-portfolio";

const EMPTY_COMPANY: CompanyData = {
  kind: "stock",
  currency: "USD",
  previousClose: null,
  open: null,
  dayLow: null,
  dayHigh: null,
  fiftyTwoWeekLow: null,
  fiftyTwoWeekHigh: null,
  volume: null,
  averageVolume: null,
  marketCap: null,
  trailingPE: null,
  forwardPE: null,
  epsTrailing: null,
  dividendRate: null,
  dividendYield: null,
  sharesOutstanding: null,
  floatShares: null,
  priceToBook: null,
  bookValue: null,
  priceToSales: null,
  beta: null,
  totalAssets: null,
  navPrice: null,
  category: null,
  ytdReturn: null,
  nextEarningsDate: null,
  exDividendDate: null,
  earnings: [],
};

/**
 * Activos que NO están en la cartera demo, con datos fijos: así los evals y los tests prueban la
 * consulta de un símbolo cualquiera sin llamar a Yahoo. Cualquier otro símbolo de afuera no existe.
 */
export const DEMO_EXTERNAL_ASSETS: Readonly<Record<string, AssetInfo>> = {
  ORCL: {
    symbol: "ORCL",
    name: "Demo Oracle",
    type: "STOCK",
    sector: "Technology",
    industry: "Software—Infrastructure",
    quote: {
      symbol: "ORCL",
      price: "182.5",
      change: "2.25",
      changePct: "0.012483",
      asOf: new Date("2026-09-30T20:00:00Z"),
      currency: "USD",
    },
    company: {
      ...EMPTY_COMPANY,
      previousClose: "180.25",
      fiftyTwoWeekLow: "120.1",
      fiftyTwoWeekHigh: "198.4",
      marketCap: 512_000_000_000,
      trailingPE: "41.2",
      epsTrailing: "4.43",
      dividendRate: "2",
      dividendYield: "0.011",
      nextEarningsDate: "2026-12-10",
      earnings: [
        {
          periodEnd: "2026-05-31",
          epsActual: "1.7",
          epsEstimate: "1.64",
          epsDifference: "0.06",
        },
        {
          periodEnd: "2026-08-31",
          epsActual: "1.47",
          epsEstimate: "1.48",
          epsDifference: "-0.01",
        },
      ],
    },
  },
  VXUS: {
    symbol: "VXUS",
    name: "Demo Total International ETF",
    type: "ETF",
    sector: null,
    industry: null,
    quote: {
      symbol: "VXUS",
      price: "68.12",
      change: "-0.34",
      changePct: "-0.004966",
      asOf: new Date("2026-09-30T20:00:00Z"),
      currency: "USD",
    },
    company: {
      ...EMPTY_COMPANY,
      kind: "etf",
      dividendYield: "0.0295",
      totalAssets: 85_400_000_000,
      category: "Foreign Large Blend",
      ytdReturn: "0.1432",
    },
  },
};

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
    // Lo de la cartera: cotización = último cierre demo (cambio contra el anterior), sin datos de
    // empresa. Lo de afuera: `DEMO_EXTERNAL_ASSETS`. Nada llama a la red.
    async assetInfo(symbol) {
      const external = DEMO_EXTERNAL_ASSETS[symbol];
      if (external) return { status: "ok", info: external };
      const instrument = DEMO_INSTRUMENTS.find((i) => i.symbol === symbol);
      if (!instrument) return { status: "not_found" };
      const closes = closesUntilToday(symbol);
      const last = closes.at(-1);
      const prev = closes.at(-2);
      const change = last && prev ? last.close.minus(prev.close) : null;
      return {
        status: "ok",
        info: {
          symbol,
          name: instrument.name,
          type:
            instrument.type === "ETF" || instrument.type === "CRYPTO"
              ? instrument.type
              : "STOCK",
          sector: instrument.sector,
          industry: null,
          quote: last
            ? {
                symbol,
                price: last.close.toFixed(),
                change: change?.toFixed() ?? null,
                changePct:
                  change && prev
                    ? change.div(prev.close).toDecimalPlaces(6).toFixed()
                    : null,
                asOf: new Date(`${last.date}T20:00:00Z`),
                currency: "USD",
              }
            : null,
          company: null,
        },
      };
    },
  };
}
