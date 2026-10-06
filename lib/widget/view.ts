import { ZERO } from "@/lib/engine";
import type { DashboardView } from "@/lib/portfolio/dashboard";
import {
  formatDayMonth,
  formatMoney,
  formatPercent,
} from "@/lib/portfolio/format";
import { buildCachedSnapshot } from "@/lib/portfolio/snapshot-cache";
import { toneOf, type Tone } from "@/lib/portfolio/tone";

// Lo que devuelve `/api/widget` (docs/widget-iphone.md): solo textos ya formateados, como el
// último estado conocido de la PWA. Nada de operaciones ni de identificadores de la base. El script
// de Scriptable (`script.ts`) lee esta forma: mantenerlos en sincronía.

export const WIDGET_VIEW_VERSION = 1;

export interface WidgetView {
  version: typeof WIDGET_VIEW_VERSION;
  /** Instante en que se calculó (ISO). */
  generatedAt: string;
  /** De qué portafolio es; `null` si la persona tiene uno solo (no hace falta decirlo). */
  title: string | null;
  /** `false` si todavía no hay operaciones: el widget lo dice en vez de mostrar ceros. */
  hasTransactions: boolean;
  totalValue: string;
  /** `true` si falta el precio de alguna posición: el total no la incluye. */
  partial: boolean;
  dayChange: string | null;
  dayChangePct: string | null;
  dayTone: Tone | null;
  /** Ganancia total (`valor − depósitos + retiros`); `null` si el total es parcial o no hay aportes. */
  totalGain: string | null;
  totalGainPct: string | null;
  gainTone: Tone | null;
  /** «precios al 05/10»: la fecha más vieja de los precios usados (hora de Montevideo). */
  pricesAsOf: string | null;
  /** Las posiciones abiertas de mayor valor. */
  positions: Array<{ symbol: string; value: string }>;
}

export function buildWidgetView(
  view: DashboardView,
  now: Date,
  title: string | null,
): WidgetView {
  const { valued } = view;
  const cached = buildCachedSnapshot(valued, now);
  return {
    version: WIDGET_VIEW_VERSION,
    generatedAt: now.toISOString(),
    title,
    hasTransactions: view.hasTransactions,
    totalValue: cached.totalValue,
    partial: view.missingPrices.length > 0,
    dayChange: cached.dayChange,
    dayChangePct: cached.dayChangePct,
    dayTone: cached.tone,
    totalGain:
      view.totalGain === null
        ? null
        : formatMoney(view.totalGain, { signed: true }),
    totalGainPct:
      view.totalGainPct === null
        ? null
        : formatPercent(view.totalGainPct, { signed: true }),
    gainTone: toneOf(view.totalGain, 2),
    pricesAsOf:
      view.oldestPriceAt === null ? null : formatDayMonth(view.oldestPriceAt),
    positions: cached.positions,
  };
}

/** Sin portafolio con cuenta (no debería pasar: la base exige al menos uno). */
export function emptyWidgetView(now: Date): WidgetView {
  return {
    version: WIDGET_VIEW_VERSION,
    generatedAt: now.toISOString(),
    title: null,
    hasTransactions: false,
    totalValue: formatMoney(ZERO),
    partial: false,
    dayChange: null,
    dayChangePct: null,
    dayTone: null,
    totalGain: null,
    totalGainPct: null,
    gainTone: null,
    pricesAsOf: null,
    positions: [],
  };
}
