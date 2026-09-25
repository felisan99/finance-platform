import type { ValuedPortfolio } from "@/lib/engine";
import { formatMoney, formatPercent } from "./format";
import { toneOf, type Tone } from "./tone";

// El "último estado conocido" que Inicio deja en el dispositivo para la pantalla sin conexión
// (spec §10.6). Solo textos ya formateados para mostrar: nada de operaciones ni de datos de la
// base, y se borra al llegar a /login. Lo lee `public/pwa/offline.js` (mantener la forma en sincronía).

export const SNAPSHOT_VERSION = 1;
/** Pasado este plazo la pantalla sin conexión no lo muestra: un estado tan viejo engaña. */
export const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SNAPSHOT_MAX_POSITIONS = 6;

export interface CachedSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** Instante en que se generó (ISO): la pantalla sin conexión lo muestra y descarta lo vencido. */
  savedAt: string;
  totalValue: string;
  dayChange: string | null;
  dayChangePct: string | null;
  tone: Tone | null;
  cash: string;
  /** Las posiciones abiertas de mayor valor, con su valor de mercado. */
  positions: Array<{ symbol: string; value: string }>;
}

// Sin `localeCompare`: el orden no puede depender del idioma del servidor.
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildCachedSnapshot(
  valued: ValuedPortfolio,
  now: Date,
): CachedSnapshot {
  const positions = valued.positions
    .flatMap((position) =>
      position.isOpen && position.marketValue !== null
        ? [{ symbol: position.symbol, amount: position.marketValue }]
        : [],
    )
    .sort(
      (a, b) =>
        b.amount.comparedTo(a.amount) || compareText(a.symbol, b.symbol),
    )
    .slice(0, SNAPSHOT_MAX_POSITIONS)
    .map(({ symbol, amount }) => ({ symbol, value: formatMoney(amount) }));

  return {
    version: SNAPSHOT_VERSION,
    savedAt: now.toISOString(),
    totalValue: formatMoney(valued.totalValue),
    dayChange:
      valued.dayChange === null
        ? null
        : formatMoney(valued.dayChange, { signed: true }),
    dayChangePct:
      valued.dayChangePct === null
        ? null
        : formatPercent(valued.dayChangePct, { signed: true }),
    tone: toneOf(valued.dayChange, 2),
    cash: formatMoney(valued.cash),
    positions,
  };
}
