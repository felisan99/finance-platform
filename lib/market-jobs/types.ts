import type {
  CorporateAction,
  DailyBar,
  InstrumentProfile,
  Quote,
} from "@/lib/market-data";

export type JobName = "daily-prices" | "backfill";
export type RunStatus = "running" | "ok" | "partial" | "error";

/** Instrumento que hay que mantener: tiene transacciones o está en alguna watchlist. */
export interface ActiveInstrument {
  id: string;
  symbol: string;
  providerSymbol: string | null;
  historyBackfilledAt: string | null;
  /** Desde qué fecha (YYYY-MM-DD) se pidió el último backfill. */
  historyFrom: string | null;
  /** Fecha (UTC) de la primera transacción de cualquier usuario. */
  firstTxDate: string | null;
  inWatchlist: boolean;
  latestPriceDate: string | null;
}

export interface StoredClose {
  date: string;
  close: string;
}

export type RunStage = "run" | "backfill" | "prices" | "quotes" | "profile";

/** Algo que salió mal en una corrida. Los de `profile` son cosméticos: no vuelven parcial la corrida. */
export interface RunIssue {
  stage: RunStage;
  symbol?: string;
  message: string;
}

export interface RunSummary {
  job: JobName;
  provider: string;
  instruments: number;
  backfilled: number;
  rebackfilled: number;
  incremental: number;
  failed: number;
  skippedForBudget: number;
  barsWritten: number;
  droppedBars: number;
  actionsWritten: number;
  quotesUpdated: number;
}

export interface FinishRun {
  status: Exclude<RunStatus, "running">;
  finishedAt: Date;
  summary: RunSummary;
  issues: RunIssue[];
}

/**
 * Puerto de persistencia de los jobs. `SupabaseMarketStore` lo implementa con la clave secreta;
 * los tests usan una versión en memoria.
 */
export interface MarketStore {
  listActiveInstruments(): Promise<ActiveInstrument[]>;
  /** Cierres guardados desde `from` (inclusive): sirven para comparar el solape con Yahoo. */
  getStoredCloses(instrumentId: string, from: string): Promise<StoredClose[]>;
  /** Claves `TIPO|fecha` de las acciones corporativas ya guardadas. */
  getStoredActionKeys(instrumentId: string): Promise<Set<string>>;
  upsertPrices(instrumentId: string, bars: DailyBar[]): Promise<void>;
  /** Borra los precios desde `from` cuyas fechas no están en `keepDates` (quedaron sin ajustar). */
  pruneStalePrices(
    instrumentId: string,
    from: string,
    keepDates: string[],
  ): Promise<number>;
  upsertCorporateActions(
    instrumentId: string,
    actions: CorporateAction[],
  ): Promise<void>;
  upsertQuotes(
    rows: Array<{ instrumentId: string; quote: Quote }>,
  ): Promise<void>;
  markBackfilled(
    instrumentId: string,
    args: { at: Date; from: string },
  ): Promise<void>;
  /** Deja el instrumento "pendiente": el próximo backfill lo descarga de nuevo completo. */
  markNeedsBackfill(instrumentId: string): Promise<void>;
  /** Completa solo los campos de perfil que estén en NULL. */
  fillProfileGaps(
    instrumentId: string,
    profile: InstrumentProfile,
  ): Promise<void>;
  startRun(job: JobName, startedAt: Date): Promise<string>;
  finishRun(runId: string, result: FinishRun): Promise<void>;
  /** Cierra como 'error' las corridas que quedaron en 'running' (la función murió a mitad). */
  failStaleRuns(startedBefore: Date, now: Date): Promise<number>;
}

export const actionKey = (action: Pick<CorporateAction, "type" | "exDate">) =>
  `${action.type}|${action.exDate}`;
