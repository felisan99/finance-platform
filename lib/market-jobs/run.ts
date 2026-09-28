import { D } from "@/lib/engine/decimal";
import { describeError, type MarketDataProvider } from "@/lib/market-data";
import { addDays, addYears, isoDate, startOfDay } from "./dates";
import {
  actionKey,
  type ActiveInstrument,
  type JobName,
  type MarketStore,
  type RunIssue,
  type RunStage,
  type RunStatus,
  type RunSummary,
} from "./types";

/** Días que se vuelven a pedir hacia atrás en cada corrida: cubre huecos y valores que Yahoo corrige. */
export const OVERLAP_DAYS = 7;
/** El historial arranca unos días antes de la primera transacción (rueda previa, feriados). */
export const TX_MARGIN_DAYS = 7;
/**
 * Historial mínimo de todo instrumento (spec §7.2): «Antes de comprar» mira el último año de la
 * cartera y hasta 5 años del candidato, también de lo que se compró hace poco.
 */
export const WATCHLIST_YEARS = 5;
/** Si un cierre ya guardado difiere más que esto de lo que hoy informa Yahoo, se reajustó (split). */
export const ADJUST_TOLERANCE = new D("0.001");
/** Una corrida 'running' de hace más que esto se da por muerta. */
export const STALE_RUN_MS = 15 * 60_000;
/** Presupuesto blando: pasado este tiempo no se arrancan instrumentos nuevos (Hobby corta a los 300 s). */
export const DEFAULT_BUDGET_MS = 240_000;
export const MAX_ISSUES = 50;

/**
 * Desde qué fecha hace falta historial: la más antigua entre la primera transacción (con margen)
 * y los últimos 5 años. Antes los 5 años eran solo de la watchlist; un instrumento que se compró
 * hace poco se completa solo en la próxima corrida (`needsBackfill`).
 */
export function desiredStart(
  instrument: ActiveInstrument,
  today: string,
): string {
  const candidates = [addYears(today, -WATCHLIST_YEARS)];
  if (instrument.firstTxDate) {
    candidates.push(addDays(instrument.firstTxDate, -TX_MARGIN_DAYS));
  }
  return candidates.sort()[0] as string;
}

/** Falta historial: nunca se descargó, quedó pendiente o una transacción nueva pide fechas más viejas. */
export function needsBackfill(
  instrument: ActiveInstrument,
  start: string,
): boolean {
  return (
    instrument.historyBackfilledAt === null ||
    instrument.historyFrom === null ||
    start < instrument.historyFrom
  );
}

export interface RefreshQuotesResult {
  updated: number;
  /** Símbolos (canónicos) sin cotización: desconocidos, dados de baja o renombrados. */
  missing: string[];
}

/**
 * Actualiza `quotes_latest` de los instrumentos indicados con una sola consulta al proveedor.
 * La usan los jobs y, en la Fase 4, el botón "Actualizar ahora".
 */
export async function refreshQuotes(args: {
  provider: MarketDataProvider;
  store: MarketStore;
  instruments: ActiveInstrument[];
}): Promise<RefreshQuotesResult> {
  const { provider, store, instruments } = args;
  const byProviderSymbol = new Map(
    instruments.map((i) => [(i.providerSymbol ?? i.symbol).toUpperCase(), i]),
  );
  if (byProviderSymbol.size === 0) return { updated: 0, missing: [] };

  const quotes = await provider.getQuotes([...byProviderSymbol.keys()]);
  const rows: Array<{ instrumentId: string; quote: (typeof quotes)[number] }> =
    [];
  const seen = new Set<string>();
  for (const quote of quotes) {
    const key = quote.symbol.toUpperCase();
    const instrument = byProviderSymbol.get(key);
    if (!instrument || seen.has(key)) continue;
    seen.add(key);
    rows.push({ instrumentId: instrument.id, quote });
  }
  if (rows.length > 0) await store.upsertQuotes(rows);

  const missing = [...byProviderSymbol]
    .filter(([key]) => !seen.has(key))
    .map(([, instrument]) => instrument.symbol);
  return { updated: rows.length, missing };
}

export interface RunMarketJobOptions {
  job: JobName;
  provider: MarketDataProvider;
  store: MarketStore;
  /** "Hoy": se recibe por parámetro, nada de leer el reloj adentro. */
  now: Date;
  budgetMs?: number;
  /** Reloj en milisegundos para medir el presupuesto (inyectable en los tests). */
  clock?: () => number;
}

export interface RunResult {
  /** null si no se pudo abrir el registro de la corrida. */
  runId: string | null;
  status: Exclude<RunStatus, "running">;
  summary: RunSummary;
  issues: RunIssue[];
}

/**
 * Corre un job de datos de mercado (spec §7.2):
 *  - `daily-prices`: para todos los instrumentos activos, historial (completo si está pendiente,
 *    incremental si no) y cotización.
 *  - `backfill`: solo los instrumentos pendientes, con su cotización.
 *
 * Cada instrumento falla de forma aislada. Nunca lanza: devuelve el resultado (y lo deja en
 * `market_job_runs`) aunque falle todo.
 */
export async function runMarketJob(
  options: RunMarketJobOptions,
): Promise<RunResult> {
  const {
    job,
    provider,
    store,
    now,
    budgetMs = DEFAULT_BUDGET_MS,
    clock = Date.now,
  } = options;
  const began = clock();
  const overBudget = () => clock() - began > budgetMs;

  const summary: RunSummary = {
    job,
    provider: provider.name,
    instruments: 0,
    backfilled: 0,
    rebackfilled: 0,
    incremental: 0,
    failed: 0,
    skippedForBudget: 0,
    barsWritten: 0,
    droppedBars: 0,
    actionsWritten: 0,
    quotesUpdated: 0,
  };
  const issues: RunIssue[] = [];
  const report = (stage: RunStage, message: string, symbol?: string) => {
    issues.push(
      symbol === undefined ? { stage, message } : { stage, symbol, message },
    );
  };

  let runId: string | null = null;
  try {
    await store.failStaleRuns(new Date(now.getTime() - STALE_RUN_MS), now);
    runId = await store.startRun(job, now);
  } catch (error) {
    report(
      "run",
      `no se pudo abrir el registro de la corrida: ${describeError(error)}`,
    );
  }

  const today = isoDate(now);
  const to = new Date(now.getTime() + 86_400_000);
  let succeeded = 0;
  let fatal = false;

  // --- Un instrumento -------------------------------------------------------------------

  async function fillProfile(instrument: ActiveInstrument, symbol: string) {
    if (!provider.getProfile) return;
    try {
      await store.fillProfileGaps(
        instrument.id,
        await provider.getProfile(symbol),
      );
    } catch (error) {
      report("profile", describeError(error), instrument.symbol);
    }
  }

  /**
   * Historial completo: reescribe todo lo que Yahoo devuelve y poda lo que quedó viejo. Arranca en
   * `start` o, si ya había historial más antiguo, en su `history_from`: tras un split no pueden
   * quedar filas viejas en la escala anterior.
   */
  async function backfill(
    instrument: ActiveInstrument,
    symbol: string,
    start: string,
  ) {
    const from =
      instrument.historyFrom !== null && instrument.historyFrom < start
        ? instrument.historyFrom
        : start;
    const history = await provider.getDailyHistory(
      symbol,
      startOfDay(from),
      to,
    );
    await store.upsertPrices(instrument.id, history.bars);
    // Sin barras no se poda: una respuesta vacía no debe borrar el historial guardado.
    if (history.bars.length > 0) {
      await store.pruneStalePrices(
        instrument.id,
        from,
        history.bars.map((bar) => bar.date),
      );
    }
    await store.upsertCorporateActions(instrument.id, history.actions);
    // El instrumento se marca como descargado al final: si algo falla antes, sigue pendiente.
    await store.markBackfilled(instrument.id, { at: now, from });
    summary.barsWritten += history.bars.length;
    summary.droppedBars += history.droppedBars;
    summary.actionsWritten += history.actions.length;
    await fillProfile(instrument, symbol);
  }

  /** Solo lo reciente. Devuelve "adjusted" si los históricos guardados quedaron viejos. */
  async function incremental(
    instrument: ActiveInstrument,
    symbol: string,
    start: string,
  ): Promise<"ok" | "adjusted"> {
    const from = instrument.latestPriceDate
      ? addDays(instrument.latestPriceDate, -OVERLAP_DAYS)
      : start;
    const history = await provider.getDailyHistory(
      symbol,
      startOfDay(from),
      to,
    );

    const stored = new Map(
      (await store.getStoredCloses(instrument.id, from)).map((row) => [
        row.date,
        row.close,
      ]),
    );
    const reAdjusted = history.bars.some((bar) => {
      const previous = stored.get(bar.date);
      return (
        previous !== undefined &&
        new D(previous)
          .minus(bar.close)
          .abs()
          .div(bar.close)
          .gt(ADJUST_TOLERANCE)
      );
    });

    const known = await store.getStoredActionKeys(instrument.id);
    const newActions = history.actions.filter(
      (action) => !known.has(actionKey(action)),
    );
    if (newActions.length > 0) {
      // Se guardan antes: así no vuelven a aparecer como "nuevas" en la corrida siguiente.
      await store.upsertCorporateActions(instrument.id, newActions);
      summary.actionsWritten += newActions.length;
    }

    // Un split reajusta `close` hacia atrás y un dividendo reajusta `adj_close`: lo guardado
    // quedó en otra escala. No se mezclan filas viejas con nuevas: se descarga todo de nuevo.
    if (reAdjusted || newActions.length > 0) {
      await store.markNeedsBackfill(instrument.id);
      return "adjusted";
    }

    await store.upsertPrices(instrument.id, history.bars);
    summary.barsWritten += history.bars.length;
    summary.droppedBars += history.droppedBars;
    return "ok";
  }

  async function process(item: {
    instrument: ActiveInstrument;
    start: string;
    pending: boolean;
  }) {
    const { instrument, start, pending } = item;
    const symbol = instrument.providerSymbol ?? instrument.symbol;
    let stage: RunStage = pending ? "backfill" : "prices";
    try {
      if (pending) {
        await backfill(instrument, symbol, start);
        summary.backfilled++;
      } else if (
        (await incremental(instrument, symbol, start)) === "adjusted"
      ) {
        stage = "backfill";
        if (overBudget()) {
          report(
            "backfill",
            "reajuste detectado (split o dividendo): el historial se vuelve a bajar en la próxima corrida",
            instrument.symbol,
          );
        } else {
          await backfill(instrument, symbol, start);
          summary.rebackfilled++;
        }
      } else {
        summary.incremental++;
      }
      return true;
    } catch (error) {
      report(stage, describeError(error), instrument.symbol);
      return false;
    }
  }

  // --- La corrida -----------------------------------------------------------------------

  try {
    const instruments = await store.listActiveInstruments();
    summary.instruments = instruments.length;

    const plan = instruments.map((instrument) => {
      const start = desiredStart(instrument, today);
      return { instrument, start, pending: needsBackfill(instrument, start) };
    });
    // Los pendientes primero: si el presupuesto se agota, que sea sobre lo que ya tiene historial.
    const targets = (
      job === "backfill" ? plan.filter((p) => p.pending) : plan
    ).sort(
      (a, b) =>
        Number(b.pending) - Number(a.pending) ||
        a.instrument.symbol.localeCompare(b.instrument.symbol),
    );

    const quoteTargets: ActiveInstrument[] =
      job === "daily-prices" ? instruments : [];
    for (const [index, item] of targets.entries()) {
      if (overBudget()) {
        summary.skippedForBudget = targets.length - index;
        report(
          "run",
          `presupuesto de tiempo agotado: quedan ${summary.skippedForBudget} instrumentos`,
        );
        break;
      }
      if (await process(item)) {
        succeeded++;
        if (job === "backfill") quoteTargets.push(item.instrument);
      } else {
        summary.failed++;
      }
    }

    if (quoteTargets.length > 0) {
      try {
        const { updated, missing } = await refreshQuotes({
          provider,
          store,
          instruments: quoteTargets,
        });
        summary.quotesUpdated = updated;
        for (const symbol of missing) {
          report(
            "quotes",
            "sin cotización del proveedor (¿dado de baja o renombrado?)",
            symbol,
          );
        }
      } catch (error) {
        report("quotes", describeError(error));
      }
    }
  } catch (error) {
    fatal = true;
    report("run", describeError(error));
  }

  const attempted = succeeded + summary.failed;
  const blocking = issues.some((issue) => issue.stage !== "profile");
  const status: RunResult["status"] =
    fatal || (attempted > 0 && succeeded === 0)
      ? "error"
      : blocking
        ? "partial"
        : "ok";

  if (runId) {
    try {
      const shown = issues.slice(0, MAX_ISSUES);
      if (issues.length > MAX_ISSUES) {
        shown.push({
          stage: "run",
          message: `…y ${issues.length - MAX_ISSUES} más`,
        });
      }
      await store.finishRun(runId, {
        status,
        finishedAt: new Date(clock()),
        summary,
        issues: shown,
      });
    } catch (error) {
      report(
        "run",
        `no se pudo cerrar el registro de la corrida: ${describeError(error)}`,
      );
    }
  }

  return { runId, status, summary, issues };
}
