import type { Dec } from "@/lib/engine";
import { formatPercent } from "./format";
import { toneOf, type Tone } from "./tone";
import type { WatchlistRowView } from "./watchlist";

// "Mayores subas / bajas del día" de la Watchlist: las filas que ya se armaron, ordenadas por su
// cambio del día, recortadas y formateadas (es-UY). Puro: recibe "ahora" por parámetro.

/** Barras por tarjeta. */
export const MOVERS_MAX = 5;
/** Un precio más viejo que esto no es "del día" (cubre un fin de semana largo con feriado). */
export const STALE_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MoverView {
  symbol: string;
  href: string;
  /** Porcentaje con signo: `+5,71%`. */
  text: string;
  tone: Tone;
  /** |cambio| sobre el mayor |cambio| de su tarjeta: 0 a 1, para el alto de la barra. */
  ratio: number;
}

export interface MoversView {
  gainers: MoverView[];
  losers: MoverView[];
}

interface Candidate {
  symbol: string;
  pct: Dec;
  tone: Tone;
}

// Sin `localeCompare`: el orden no puede depender del idioma del servidor.
const bySymbol = (a: Candidate, b: Candidate) =>
  a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;

function toMovers(candidates: readonly Candidate[]): MoverView[] {
  const largest = candidates[0]?.pct.abs();
  return candidates.map((candidate) => ({
    symbol: candidate.symbol,
    href: `/positions/${encodeURIComponent(candidate.symbol)}`,
    text: formatPercent(candidate.pct, { signed: true }),
    tone: candidate.tone,
    ratio:
      largest === undefined || largest.isZero()
        ? 0
        : candidate.pct.abs().div(largest).toNumber(),
  }));
}

/**
 * Las que más subieron (de mayor a menor) y las que más bajaron (de la que más bajó a la que menos),
 * hasta `MOVERS_MAX` cada una. Entra el cambio del día que muestra cada fila, si su precio no tiene
 * más de `STALE_DAYS` días; lo que redondea a 0,00 % no entra en ninguna. `null` si hay menos de dos
 * símbolos con cambio: con uno solo la sección repetiría la fila de abajo.
 */
export function buildMoversView(
  rows: readonly WatchlistRowView[],
  now: Date,
): MoversView | null {
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (row.dayChangePct === null || row.priceAsOf === null) continue;
    if (now.getTime() - row.priceAsOf.getTime() > STALE_DAYS * DAY_MS) continue;
    const tone = toneOf(row.dayChangePct, 4);
    if (tone === null || tone === "flat") continue;
    candidates.push({ symbol: row.symbol, pct: row.dayChangePct, tone });
  }
  if (candidates.length < 2) return null;

  const gainers = candidates
    .filter((candidate) => candidate.tone === "gain")
    .sort((a, b) => b.pct.cmp(a.pct) || bySymbol(a, b))
    .slice(0, MOVERS_MAX);
  const losers = candidates
    .filter((candidate) => candidate.tone === "loss")
    .sort((a, b) => a.pct.cmp(b.pct) || bySymbol(a, b))
    .slice(0, MOVERS_MAX);
  return { gainers: toMovers(gainers), losers: toMovers(losers) };
}
