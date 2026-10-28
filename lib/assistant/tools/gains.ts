import { realizedEvents, summarizeRealized } from "@/lib/engine";
import { formatMoney, formatPercent } from "@/lib/portfolio/format";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { checkRange, checkSymbol, fail, ok, rangeText } from "./shared";

export interface GainsInput {
  desde?: string;
  hasta?: string;
  simbolo?: string;
}

/**
 * Ganancia realizada (por las ventas con fecha en el rango, o en todo el historial) y no
 * realizada de hoy, por activo. La no realizada no tiene período: es la de las posiciones abiertas
 * valuadas a hoy.
 */
export async function getGains(
  ds: AssistantDataSource,
  input: GainsInput,
): Promise<ToolResult> {
  let from: string | null = null;
  let to: string | null = null;
  const notes: string[] = [];
  if (input.desde || input.hasta) {
    if (!input.desde || !input.hasta) {
      return fail("Para un período hacen falta las dos fechas, desde y hasta.");
    }
    const range = checkRange(input.desde, input.hasta, ds.now);
    if (!range.ok) return fail(range.error);
    ({ from, to } = range);
    if (range.clipped) notes.push("El período se recortó a hoy.");
  }
  let symbol: string | null = null;
  if (input.simbolo) {
    const check = checkSymbol(input.simbolo);
    if (!check.ok) return fail(check.error);
    symbol = check.symbol;
  }

  const snapshot = await ds.snapshot();
  // Por cuenta: el costo promedio es de cada una (nunca se mezclan cuentas en un mismo libro).
  const events = snapshot.parts
    .flatMap((part) =>
      realizedEvents(part.transactions, {
        currency: part.portfolio.account.currency,
      }),
    )
    .filter((event) => symbol === null || event.symbol === symbol);
  const realized = summarizeRealized(events, from, to);

  const open = snapshot.valued.positions.filter(
    (p) => p.isOpen && (symbol === null || p.symbol === symbol),
  );
  const missing = open
    .filter((p) => p.unrealizedPnl === null)
    .map(
      (p) =>
        `Sin precio para ${p.symbol}: su ganancia no realizada no se puede calcular.`,
    );
  if (
    symbol !== null &&
    open.length === 0 &&
    !snapshot.engine.positions.some((p) => p.symbol === symbol)
  ) {
    missing.push(`No hay operaciones de ${symbol} en este portafolio.`);
  }

  const period = from && to ? rangeText(from, to) : "todo el historial";
  return ok(
    { fn: "realizedEvents + valuePortfolio", detail: period },
    {
      portafolio: ds.scopeName,
      periodo_realizada: period,
      realizada_total: formatMoney(realized.total, { signed: true }),
      ventas: realized.sales,
      realizada_por_activo: realized.bySymbol.map((row) => ({
        simbolo: row.symbol,
        realizada: formatMoney(row.realized, { signed: true }),
        ventas: row.sales,
      })),
      no_realizada_hoy: open.map((p) => ({
        simbolo: p.symbol,
        no_realizada: formatMoney(p.unrealizedPnl, { signed: true }),
        no_realizada_pct: formatPercent(p.unrealizedPct, { signed: true }),
      })),
      no_realizada_total_hoy:
        symbol === null
          ? formatMoney(snapshot.valued.unrealizedPnl, { signed: true })
          : null,
    },
    {
      missing,
      notes: [
        ...notes,
        "La ganancia no realizada es la de hoy; no depende del período.",
      ],
    },
  );
}
