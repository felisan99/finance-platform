import {
  computeEngine,
  d,
  pickPrice,
  valuePortfolio,
  type EngineResult,
  type PriceInfo,
  type Transaction,
  type ValuedPortfolio,
} from "@/lib/engine";
import { rowToTransaction } from "./mappers";
import type { PortfolioRef } from "./portfolio-scope";
import type {
  AccountRow,
  ClosesRow,
  InstrumentRow,
  QuoteRow,
  TransactionRow,
} from "./rows";

export interface SnapshotInput {
  portfolio: PortfolioRef;
  transactionRows: readonly TransactionRow[];
  instruments: readonly InstrumentRow[];
  quotes: readonly QuoteRow[];
  closes: readonly ClosesRow[];
}

/** Todo lo que necesitan las pantallas, calculado a partir de filas de la base (sin I/O). */
export interface PortfolioSnapshot {
  portfolio: PortfolioRef;
  /** La cuenta del portafolio (`portfolio.account`). */
  account: AccountRow;
  rows: readonly TransactionRow[];
  /** Las transacciones ya convertidas para el motor, en el orden de las filas. */
  transactions: Transaction[];
  instrumentById: ReadonlyMap<string, InstrumentRow>;
  instrumentBySymbol: ReadonlyMap<string, InstrumentRow>;
  engine: EngineResult;
  /** Precio de valuación por símbolo (solo los que tienen cotización o cierre). */
  prices: ReadonlyMap<string, PriceInfo>;
  valued: ValuedPortfolio;
}

/**
 * Arma el estado del portafolio: transacciones → motor → valuación con la cotización o el último
 * cierre de cada símbolo (spec §6.3). Lanza si una transacción apunta a un instrumento que no
 * vino en `instruments` (los CHECK y las FK de la base lo impiden).
 */
export function buildSnapshot(input: SnapshotInput): PortfolioSnapshot {
  const instrumentById = new Map(input.instruments.map((i) => [i.id, i]));
  const instrumentBySymbol = new Map(
    input.instruments.map((i) => [i.symbol, i]),
  );
  const symbolById = new Map(input.instruments.map((i) => [i.id, i.symbol]));

  const transactions = input.transactionRows.map((row) =>
    rowToTransaction(row, input.portfolio.account.id, symbolById),
  );
  const engine = computeEngine(transactions, {
    currency: input.portfolio.account.currency,
  });

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
    portfolio: input.portfolio,
    account: input.portfolio.account,
    rows: input.transactionRows,
    transactions,
    instrumentById,
    instrumentBySymbol,
    engine,
    prices,
    valued: valuePortfolio(engine, prices),
  };
}
