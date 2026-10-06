import type { ActiveInstrument } from "@/lib/market-jobs";
import type { InstrumentRow } from "./rows";

// A qué instrumentos les pide cotización "Actualizar precios" y cómo cuenta el resultado. Puro.

export interface RefreshTargets {
  /** Posiciones abiertas, símbolos seguidos y, si hace falta, los benchmarks; sin repetir. */
  instruments: InstrumentRow[];
  /**
   * Los benchmarks que se agregaron solo para el gráfico (la persona no los tiene ni los sigue): no
   * se cuentan en el mensaje de resultado. Vacío si ya estaban entre los otros o no hay benchmark.
   */
  extraBenchmarks: InstrumentRow[];
}

/**
 * Las posiciones abiertas (de todos los portafolios) y los símbolos seguidos, más los benchmarks de
 * los portafolios: el gráfico de rendimiento compara contra ellos y necesita su cotización de hoy
 * para cerrar el mismo día que el portafolio (`live-series.ts`). Sin posiciones ni seguidos no hay
 * nada que actualizar, ni siquiera los benchmarks.
 */
export function collectRefreshTargets(args: {
  openSymbols: readonly string[];
  instrumentBySymbol: ReadonlyMap<string, InstrumentRow>;
  followed: readonly InstrumentRow[];
  benchmarks: readonly InstrumentRow[];
}): RefreshTargets {
  const byId = new Map<string, InstrumentRow>();
  for (const symbol of args.openSymbols) {
    const instrument = args.instrumentBySymbol.get(symbol);
    if (instrument) byId.set(instrument.id, instrument);
  }
  for (const instrument of args.followed) byId.set(instrument.id, instrument);
  if (byId.size === 0) return { instruments: [], extraBenchmarks: [] };

  const extraBenchmarks: InstrumentRow[] = [];
  for (const benchmark of args.benchmarks) {
    if (byId.has(benchmark.id)) continue;
    byId.set(benchmark.id, benchmark);
    extraBenchmarks.push(benchmark);
  }
  return { instruments: [...byId.values()], extraBenchmarks };
}

/** El mensaje de la persona: los benchmarks agregados por nosotros no cuentan como "actualizados". */
export function refreshMessage(
  result: { updated: number; missing: readonly string[] },
  extraBenchmarks: ReadonlyArray<Pick<InstrumentRow, "symbol">>,
): string {
  let updated = result.updated;
  let missing = [...result.missing];
  for (const { symbol } of extraBenchmarks) {
    if (missing.includes(symbol)) {
      missing = missing.filter((other) => other !== symbol);
    } else {
      updated -= 1;
    }
  }
  return missing.length > 0
    ? `Actualizado (${updated}). Sin cotización: ${missing.join(", ")}.`
    : `Precios actualizados (${updated}).`;
}

/**
 * Los instrumentos como los recibe `refreshQuotes`: solo se piden cotizaciones, así que lo del
 * historial queda vacío. Lo usan «Actualizar precios» y el widget.
 */
export function toQuoteInstruments(
  instruments: readonly InstrumentRow[],
): ActiveInstrument[] {
  return instruments.map((instrument) => ({
    id: instrument.id,
    symbol: instrument.symbol,
    providerSymbol: instrument.provider_symbol,
    historyBackfilledAt: null,
    historyFrom: null,
    firstTxDate: null,
    inWatchlist: false,
    latestPriceDate: null,
  }));
}
