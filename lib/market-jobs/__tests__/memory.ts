import { D } from "@/lib/engine/decimal";
import {
  MarketDataError,
  type CorporateAction,
  type DailyBar,
  type DailyHistory,
  type InstrumentProfile,
  type MarketDataProvider,
  type Quote,
} from "@/lib/market-data";
import { addDays, isoDate } from "../dates";
import {
  actionKey,
  type ActiveInstrument,
  type FinishRun,
  type JobName,
  type MarketStore,
  type RunStatus,
  type StoredClose,
} from "../types";

// ---------------------------------------------------------------------------------------------
// Mercado falso: simula lo esencial de Yahoo. Devuelve las barras de una ventana [from, to), y un
// split reajusta hacia atrás TODOS los cierres anteriores, un dividendo reajusta `adj_close`.
// ---------------------------------------------------------------------------------------------

interface Series {
  bars: Map<string, { close: string; adjClose: string }>;
  actions: CorporateAction[];
}

export function businessDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(date);
  }
  return days;
}

export class FakeMarket implements MarketDataProvider {
  readonly name = "fake";
  private readonly series = new Map<string, Series>();
  private readonly quotesBySymbol = new Map<string, Quote>();
  private readonly historyErrors = new Map<string, Error>();
  private quotesError: Error | null = null;
  private readonly profiles = new Map<string, InstrumentProfile | Error>();

  readonly calls = {
    history: [] as Array<{ symbol: string; from: string; to: string }>,
    quotes: [] as string[][],
    profile: [] as string[],
  };

  /** Serie de días hábiles con cierre = base + índice (y adj_close igual). */
  addSeries(symbol: string, from: string, to: string, base = 100): void {
    const bars = new Map<string, { close: string; adjClose: string }>();
    businessDays(from, to).forEach((date, i) => {
      const close = String(base + i);
      bars.set(date, { close, adjClose: close });
    });
    this.series.set(symbol, { bars, actions: [] });
    this.setQuote(symbol, String(base));
  }

  /** Agrega la rueda del día siguiente (o la fecha indicada). */
  addBar(symbol: string, date: string, close: string): void {
    this.mustSeries(symbol).bars.set(date, { close, adjClose: close });
  }

  setClose(symbol: string, date: string, close: string): void {
    const bar = this.mustSeries(symbol).bars.get(date);
    if (!bar) throw new Error(`sin barra ${symbol} ${date}`);
    bar.close = close;
    bar.adjClose = close;
  }

  deleteBar(symbol: string, date: string): void {
    this.mustSeries(symbol).bars.delete(date);
  }

  /** Split con fecha ex `exDate`: los cierres anteriores se dividen por `ratio` (hacia atrás). */
  split(symbol: string, exDate: string, ratio: number): void {
    const s = this.mustSeries(symbol);
    for (const [date, bar] of s.bars) {
      if (date < exDate) {
        bar.close = new D(bar.close).div(ratio).toDecimalPlaces(6).toFixed();
        bar.adjClose = new D(bar.adjClose)
          .div(ratio)
          .toDecimalPlaces(6)
          .toFixed();
      }
    }
    s.actions.push({ type: "SPLIT", exDate, ratio: String(ratio) });
  }

  /** Dividendo: el `close` no cambia pero `adj_close` de todo lo anterior baja un 1 %. */
  dividend(symbol: string, exDate: string, amount: string): void {
    const s = this.mustSeries(symbol);
    for (const [date, bar] of s.bars) {
      if (date < exDate) {
        bar.adjClose = new D(bar.adjClose)
          .times("0.99")
          .toDecimalPlaces(6)
          .toFixed();
      }
    }
    s.actions.push({ type: "DIVIDEND", exDate, amount });
  }

  setQuote(
    symbol: string,
    price: string,
    asOf = new Date("2026-09-23T20:00:00.000Z"),
  ): void {
    this.quotesBySymbol.set(symbol, {
      symbol,
      price,
      change: "1",
      changePct: "0.01",
      asOf,
      currency: "USD",
    });
  }

  removeQuote(symbol: string): void {
    this.quotesBySymbol.delete(symbol);
  }

  failHistory(
    symbol: string,
    error: Error = new MarketDataError("UNAVAILABLE", "caído"),
  ): void {
    this.historyErrors.set(symbol, error);
  }

  recoverHistory(symbol: string): void {
    this.historyErrors.delete(symbol);
  }

  failQuotes(error: Error = new MarketDataError("UNAVAILABLE", "caído")): void {
    this.quotesError = error;
  }

  setProfile(symbol: string, profile: InstrumentProfile | Error): void {
    this.profiles.set(symbol, profile);
  }

  /** Lo que devolvería el proveedor ahora para toda la serie (sirve de "verdad" en los asserts). */
  snapshot(
    symbol: string,
  ): Array<{ date: string; close: string; adjClose: string }> {
    return [...this.mustSeries(symbol).bars]
      .map(([date, bar]) => ({ date, ...bar }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private mustSeries(symbol: string): Series {
    const s = this.series.get(symbol);
    if (!s) throw new Error(`serie desconocida: ${symbol}`);
    return s;
  }

  async search(): Promise<never[]> {
    return [];
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    this.calls.quotes.push(symbols);
    if (this.quotesError) throw this.quotesError;
    return symbols.flatMap((s) => {
      const quote = this.quotesBySymbol.get(s);
      return quote ? [quote] : [];
    });
  }

  async getDailyHistory(
    symbol: string,
    from: Date,
    to: Date,
  ): Promise<DailyHistory> {
    const fromDate = isoDate(from);
    const toDate = isoDate(to);
    this.calls.history.push({ symbol, from: fromDate, to: toDate });
    const failure = this.historyErrors.get(symbol);
    if (failure) throw failure;
    const s = this.series.get(symbol);
    if (!s)
      throw new MarketDataError("NOT_FOUND", "símbolo desconocido", { symbol });

    const bars: DailyBar[] = [...s.bars]
      .filter(([date]) => date >= fromDate && date < toDate)
      .map(([date, bar]) => ({
        date,
        close: bar.close,
        adjClose: bar.adjClose,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const actions = s.actions.filter(
      (a) => a.exDate >= fromDate && a.exDate < toDate,
    );
    return { bars, actions, droppedBars: 0 };
  }

  async getProfile(symbol: string): Promise<InstrumentProfile> {
    this.calls.profile.push(symbol);
    const profile = this.profiles.get(symbol);
    if (profile instanceof Error) throw profile;
    return (
      profile ?? {
        symbol,
        name: `${symbol} Inc.`,
        type: "STOCK",
        exchange: "NasdaqGS",
        currency: "USD",
        sector: "Tech",
        industry: "Software",
      }
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Store en memoria con las mismas reglas que el de Supabase (upsert por clave, poda, perfil).
// ---------------------------------------------------------------------------------------------

export interface MemoryInstrument {
  id: string;
  symbol: string;
  providerSymbol: string | null;
  historyBackfilledAt: string | null;
  historyFrom: string | null;
  firstTxDate: string | null;
  inWatchlist: boolean;
  profile: {
    name: string | null;
    type: string | null;
    exchange: string | null;
    sector: string | null;
    industry: string | null;
  };
}

export interface MemoryRun {
  id: string;
  job: JobName;
  startedAt: Date;
  status: RunStatus;
  finished?: FinishRun;
  staleAt?: Date;
}

export class MemoryStore implements MarketStore {
  readonly instruments = new Map<string, MemoryInstrument>();
  readonly prices = new Map<
    string,
    Map<string, { close: string; adjClose: string | null }>
  >();
  readonly actions = new Map<string, Map<string, CorporateAction>>();
  readonly quotes = new Map<string, Quote>();
  readonly runs: MemoryRun[] = [];
  /** Registro de operaciones de escritura, en orden, para verificar secuencias. */
  readonly log: string[] = [];
  private failures = new Map<string, Error>();

  /** Hace fallar la próxima llamada (y las siguientes) del método indicado. */
  failOn(
    method: keyof MarketStore,
    error: Error = new Error(`${method} falló`),
  ): void {
    this.failures.set(method, error);
  }

  private guard(method: keyof MarketStore): void {
    const error = this.failures.get(method);
    if (error) throw error;
  }

  addInstrument(
    symbol: string,
    options: Partial<Omit<MemoryInstrument, "id" | "symbol" | "profile">> & {
      profile?: Partial<MemoryInstrument["profile"]>;
    } = {},
  ): MemoryInstrument {
    const instrument: MemoryInstrument = {
      id: `id-${symbol}`,
      symbol,
      providerSymbol: null,
      historyBackfilledAt: null,
      historyFrom: null,
      firstTxDate: null,
      inWatchlist: false,
      ...options,
      profile: {
        name: null,
        type: null,
        exchange: null,
        sector: null,
        industry: null,
        ...options.profile,
      },
    };
    this.instruments.set(instrument.id, instrument);
    return instrument;
  }

  idOf(symbol: string): string {
    return `id-${symbol}`;
  }

  /** Cierres guardados de un símbolo, ordenados por fecha. */
  closesOf(
    symbol: string,
  ): Array<{ date: string; close: string; adjClose: string | null }> {
    return [...(this.prices.get(this.idOf(symbol)) ?? [])]
      .map(([date, row]) => ({ date, ...row }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  actionsOf(symbol: string): CorporateAction[] {
    return [...(this.actions.get(this.idOf(symbol))?.values() ?? [])].sort(
      (a, b) => actionKey(a).localeCompare(actionKey(b)),
    );
  }

  private latestPriceDate(id: string): string | null {
    const dates = [...(this.prices.get(id)?.keys() ?? [])].sort();
    return dates.at(-1) ?? null;
  }

  async listActiveInstruments(): Promise<ActiveInstrument[]> {
    this.guard("listActiveInstruments");
    return [...this.instruments.values()]
      .filter((i) => i.firstTxDate !== null || i.inWatchlist)
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((i) => ({
        id: i.id,
        symbol: i.symbol,
        providerSymbol: i.providerSymbol,
        historyBackfilledAt: i.historyBackfilledAt,
        historyFrom: i.historyFrom,
        firstTxDate: i.firstTxDate,
        inWatchlist: i.inWatchlist,
        latestPriceDate: this.latestPriceDate(i.id),
      }));
  }

  async getStoredCloses(
    instrumentId: string,
    from: string,
  ): Promise<StoredClose[]> {
    this.guard("getStoredCloses");
    return [...(this.prices.get(instrumentId) ?? [])]
      .filter(([date]) => date >= from)
      .map(([date, row]) => ({ date, close: row.close }));
  }

  async getStoredActionKeys(instrumentId: string): Promise<Set<string>> {
    this.guard("getStoredActionKeys");
    return new Set(this.actions.get(instrumentId)?.keys());
  }

  async upsertPrices(instrumentId: string, bars: DailyBar[]): Promise<void> {
    this.guard("upsertPrices");
    this.log.push(`upsertPrices ${instrumentId} ${bars.length}`);
    const rows = this.prices.get(instrumentId) ?? new Map();
    for (const bar of bars)
      rows.set(bar.date, { close: bar.close, adjClose: bar.adjClose });
    this.prices.set(instrumentId, rows);
  }

  async pruneStalePrices(
    instrumentId: string,
    from: string,
    keepDates: string[],
  ): Promise<number> {
    this.guard("pruneStalePrices");
    const keep = new Set(keepDates);
    const rows = this.prices.get(instrumentId);
    let removed = 0;
    for (const date of [...(rows?.keys() ?? [])]) {
      if (date >= from && !keep.has(date)) {
        rows?.delete(date);
        removed++;
      }
    }
    this.log.push(`prune ${instrumentId} ${removed}`);
    return removed;
  }

  async upsertCorporateActions(
    instrumentId: string,
    actions: CorporateAction[],
  ): Promise<void> {
    this.guard("upsertCorporateActions");
    const rows = this.actions.get(instrumentId) ?? new Map();
    for (const action of actions) rows.set(actionKey(action), action);
    this.actions.set(instrumentId, rows);
    this.log.push(`upsertActions ${instrumentId} ${actions.length}`);
  }

  async upsertQuotes(
    rows: Array<{ instrumentId: string; quote: Quote }>,
  ): Promise<void> {
    this.guard("upsertQuotes");
    for (const row of rows) this.quotes.set(row.instrumentId, row.quote);
    this.log.push(`upsertQuotes ${rows.length}`);
  }

  async markBackfilled(
    instrumentId: string,
    args: { at: Date; from: string },
  ): Promise<void> {
    this.guard("markBackfilled");
    const instrument = this.instruments.get(instrumentId);
    if (!instrument) throw new Error("instrumento desconocido");
    instrument.historyBackfilledAt = args.at.toISOString();
    instrument.historyFrom = args.from;
    this.log.push(`markBackfilled ${instrument.symbol} ${args.from}`);
  }

  async markNeedsBackfill(instrumentId: string): Promise<void> {
    this.guard("markNeedsBackfill");
    const instrument = this.instruments.get(instrumentId);
    if (!instrument) throw new Error("instrumento desconocido");
    instrument.historyBackfilledAt = null;
    this.log.push(`markNeedsBackfill ${instrument.symbol}`);
  }

  async fillProfileGaps(
    instrumentId: string,
    profile: InstrumentProfile,
  ): Promise<void> {
    this.guard("fillProfileGaps");
    const instrument = this.instruments.get(instrumentId);
    if (!instrument) throw new Error("instrumento desconocido");
    const p = instrument.profile;
    p.name ??= profile.name;
    p.type ??= profile.type;
    p.exchange ??= profile.exchange;
    p.sector ??= profile.sector;
    p.industry ??= profile.industry;
    this.log.push(`fillProfile ${instrument.symbol}`);
  }

  async startRun(job: JobName, startedAt: Date): Promise<string> {
    this.guard("startRun");
    const run: MemoryRun = {
      id: `run-${this.runs.length + 1}`,
      job,
      startedAt,
      status: "running",
    };
    this.runs.push(run);
    return run.id;
  }

  async finishRun(runId: string, result: FinishRun): Promise<void> {
    this.guard("finishRun");
    const run = this.runs.find((r) => r.id === runId);
    if (!run) throw new Error("corrida desconocida");
    run.status = result.status;
    run.finished = result;
  }

  async failStaleRuns(startedBefore: Date, now: Date): Promise<number> {
    this.guard("failStaleRuns");
    let count = 0;
    for (const run of this.runs) {
      if (run.status === "running" && run.startedAt < startedBefore) {
        run.status = "error";
        run.staleAt = now;
        count++;
      }
    }
    return count;
  }
}

/** Instantánea de todo lo que el store guarda de mercado (sin el registro de corridas). */
export function marketState(store: MemoryStore): string {
  return JSON.stringify({
    prices: [...store.prices]
      .map(([id, rows]) => [id, [...rows].sort()])
      .sort(),
    actions: [...store.actions]
      .map(([id, rows]) => [id, [...rows.entries()].sort()])
      .sort(),
    quotes: [...store.quotes].sort(),
    instruments: [...store.instruments.values()],
  });
}
