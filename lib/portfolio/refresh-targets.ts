import type { InstrumentRow } from "./rows";

// A qué instrumentos les pide cotización "Actualizar precios" y cómo cuenta el resultado. Puro.

export interface RefreshTargets {
  /** Posiciones abiertas, símbolos seguidos y, si hace falta, el benchmark; sin repetir. */
  instruments: InstrumentRow[];
  /**
   * El benchmark cuando se agregó solo para el gráfico (la persona no lo tiene ni lo sigue): no se
   * cuenta en el mensaje de resultado. `null` si ya estaba entre los otros o no hay benchmark.
   */
  extraBenchmark: InstrumentRow | null;
}

/**
 * Las posiciones abiertas y los símbolos seguidos, más el benchmark: el gráfico de rendimiento
 * compara contra él y necesita su cotización de hoy para cerrar el mismo día que el portafolio
 * (`live-series.ts`). Sin posiciones ni seguidos no hay nada que actualizar, ni siquiera el
 * benchmark.
 */
export function collectRefreshTargets(args: {
  openSymbols: readonly string[];
  instrumentBySymbol: ReadonlyMap<string, InstrumentRow>;
  followed: readonly InstrumentRow[];
  benchmark: InstrumentRow | null;
}): RefreshTargets {
  const byId = new Map<string, InstrumentRow>();
  for (const symbol of args.openSymbols) {
    const instrument = args.instrumentBySymbol.get(symbol);
    if (instrument) byId.set(instrument.id, instrument);
  }
  for (const instrument of args.followed) byId.set(instrument.id, instrument);
  if (byId.size === 0) return { instruments: [], extraBenchmark: null };

  const extraBenchmark =
    args.benchmark !== null && !byId.has(args.benchmark.id)
      ? args.benchmark
      : null;
  if (extraBenchmark) byId.set(extraBenchmark.id, extraBenchmark);
  return { instruments: [...byId.values()], extraBenchmark };
}

/** El mensaje de la persona: el benchmark agregado por nosotros no cuenta como "actualizado". */
export function refreshMessage(
  result: { updated: number; missing: readonly string[] },
  extraBenchmark: Pick<InstrumentRow, "symbol"> | null,
): string {
  let updated = result.updated;
  let missing = [...result.missing];
  if (extraBenchmark) {
    if (missing.includes(extraBenchmark.symbol)) {
      missing = missing.filter((symbol) => symbol !== extraBenchmark.symbol);
    } else {
      updated -= 1;
    }
  }
  return missing.length > 0
    ? `Actualizado (${updated}). Sin cotización: ${missing.join(", ")}.`
    : `Precios actualizados (${updated}).`;
}
