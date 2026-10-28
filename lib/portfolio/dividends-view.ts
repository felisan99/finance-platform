import { d, type Dec } from "@/lib/engine";
import { formatDateKey } from "./chart-format";
import type { PendingDividend } from "./dividends-data";
import {
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "./format";

// Textos de la pantalla de dividendos detectados: el cliente recibe todo formateado.

export interface PendingDividendView {
  key: string;
  symbol: string;
  /** `null` con un solo portafolio (no hace falta decirlo). */
  portfolioName: string | null;
  exDate: string;
  /** `100 acciones × US$ 0,5100`. */
  detail: string;
  gross: string;
  withholding: string;
  net: string;
}

/** Las retenciones que se ofrecen (fracción → texto). 30 % es la de EE. UU. sin convenio. */
export const WITHHOLDING_OPTIONS = [
  { value: "0.30", label: "30% · sin convenio con EE. UU. (Uruguay y otros)" },
  { value: "0.15", label: "15% · con convenio (p. ej. España, México)" },
  { value: "0.10", label: "10%" },
  { value: "0", label: "0% · sin retención" },
] as const;

export type WithholdingValue = (typeof WITHHOLDING_OPTIONS)[number]["value"];

/** La opción que corresponde a la tasa guardada (o la más cercana, si se guardó otra). */
export function withholdingValueOf(rate: Dec): WithholdingValue {
  let best: WithholdingValue = WITHHOLDING_OPTIONS[0].value;
  let distance: Dec | null = null;
  for (const option of WITHHOLDING_OPTIONS) {
    const gap = d(option.value).minus(rate).abs();
    if (distance === null || gap.lt(distance)) {
      best = option.value;
      distance = gap;
    }
  }
  return best;
}

export function buildPendingDividendsView(
  items: readonly PendingDividend[],
  multiplePortfolios: boolean,
): PendingDividendView[] {
  return items.map(({ key, portfolio, suggestion: s }) => ({
    key,
    symbol: s.symbol,
    portfolioName: multiplePortfolios ? portfolio.name : null,
    exDate: formatDateKey(s.exDate),
    detail: `${formatQuantity(s.shares)} × ${formatPrice(s.perShare, { currency: true })}`,
    gross: formatMoney(s.gross),
    withholding: formatMoney(s.withholding.neg()),
    net: formatMoney(s.net),
  }));
}

export const withholdingText = (rate: Dec): string => formatPercent(rate);
