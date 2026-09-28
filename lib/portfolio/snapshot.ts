import {
  combineEngineResults,
  computeEngine,
  d,
  pickPrice,
  sortTransactions,
  valuePortfolio,
  type EngineResult,
  type PriceInfo,
  type Transaction,
  type ValuedPortfolio,
} from "@/lib/engine";
import { rowToTransaction } from "./mappers";
import {
  benchmarkOfScope,
  type PortfolioRef,
  type PortfolioScope,
} from "./portfolio-scope";
import type {
  ClosesRow,
  InstrumentRow,
  QuoteRow,
  TransactionRow,
} from "./rows";

export interface SnapshotInput {
  scope: PortfolioScope;
  /** Las filas de cada portafolio del alcance (uno solo, o todos con «Todo junto»). */
  parts: ReadonlyArray<{
    portfolio: PortfolioRef;
    transactionRows: readonly TransactionRow[];
  }>;
  instruments: readonly InstrumentRow[];
  quotes: readonly QuoteRow[];
  closes: readonly ClosesRow[];
}

/** Un portafolio del alcance, con su libro: el motor corre por cuenta. */
export interface SnapshotPart {
  portfolio: PortfolioRef;
  rows: readonly TransactionRow[];
  /** Las transacciones de su cuenta, en el orden de las filas. */
  transactions: Transaction[];
  engine: EngineResult;
}

/**
 * Todo lo que necesitan las pantallas, calculado a partir de filas de la base (sin I/O). Con un
 * portafolio, `engine` es el de su cuenta; con «Todo junto», la suma de las cuentas
 * (`combineEngineResults`). Lo que depende del libro de cada cuenta (la serie histórica, las
 * operaciones de un símbolo) se lee de `parts`.
 */
export interface PortfolioSnapshot {
  scope: PortfolioScope;
  parts: SnapshotPart[];
  /** Las transacciones de todas las partes, en orden cronológico (no son de una sola cuenta). */
  transactions: Transaction[];
  instrumentById: ReadonlyMap<string, InstrumentRow>;
  instrumentBySymbol: ReadonlyMap<string, InstrumentRow>;
  engine: EngineResult;
  /** Precio de valuación por símbolo (solo los que tienen cotización o cierre). */
  prices: ReadonlyMap<string, PriceInfo>;
  valued: ValuedPortfolio;
  /** Contra qué se compara el rendimiento (`benchmarkOfScope`). */
  benchmarkSymbol: string;
}

/**
 * Arma el estado del alcance: transacciones de cada cuenta → motor (por cuenta) → suma →
 * valuación con la cotización o el último cierre de cada símbolo (spec §6.3). Lanza si una
 * transacción apunta a un instrumento que no vino en `instruments` (los CHECK y las FK de la base
 * lo impiden).
 */
export function buildSnapshot(input: SnapshotInput): PortfolioSnapshot {
  const instrumentById = new Map(input.instruments.map((i) => [i.id, i]));
  const instrumentBySymbol = new Map(
    input.instruments.map((i) => [i.symbol, i]),
  );
  const symbolById = new Map(input.instruments.map((i) => [i.id, i.symbol]));

  const parts: SnapshotPart[] = input.parts.map(
    ({ portfolio, transactionRows }) => {
      const transactions = transactionRows.map((row) =>
        rowToTransaction(row, portfolio.account.id, symbolById),
      );
      return {
        portfolio,
        rows: transactionRows,
        transactions,
        engine: computeEngine(transactions, {
          currency: portfolio.account.currency,
        }),
      };
    },
  );
  // Con una sola parte, su resultado tal cual (sin pasar por la suma).
  const engine =
    parts.length === 1
      ? parts[0]!.engine
      : combineEngineResults(parts.map((part) => part.engine));

  const quoteById = new Map(input.quotes.map((q) => [q.instrument_id, q]));
  const closesById = new Map(input.closes.map((c) => [c.instrument_id, c]));

  const prices = new Map<string, PriceInfo>();
  for (const position of engine.positions) {
    const instrument = instrumentBySymbol.get(position.symbol);
    if (!instrument || !position.isOpen) continue;
    const quote = quoteById.get(instrument.id);
    const closes = closesById.get(instrument.id);
    const picked = pickPrice(
      quote
        ? {
            price: d(quote.price),
            change: quote.change === null ? null : d(quote.change),
            asOf: new Date(quote.as_of),
          }
        : null,
      closes
        ? {
            last: { date: closes.last_date, close: d(closes.last_close) },
            prev:
              closes.prev_close !== null && closes.prev_date !== null
                ? { date: closes.prev_date, close: d(closes.prev_close) }
                : null,
          }
        : null,
    );
    if (picked) prices.set(position.symbol, picked);
  }

  return {
    scope: input.scope,
    parts,
    transactions:
      parts.length === 1
        ? parts[0]!.transactions
        : sortTransactions(parts.flatMap((part) => part.transactions)),
    instrumentById,
    instrumentBySymbol,
    engine,
    prices,
    valued: valuePortfolio(engine, prices),
    benchmarkSymbol: benchmarkOfScope(input.scope),
  };
}
