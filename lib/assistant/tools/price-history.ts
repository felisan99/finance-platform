import { summarizeCloses } from "@/lib/engine";
import { formatDateKey } from "@/lib/portfolio/chart-format";
import { formatPercent, formatPrice } from "@/lib/portfolio/format";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { checkRange, checkSymbol, fail, ok, rangeText } from "./shared";

export interface PriceHistoryInput {
  simbolo: string;
  desde: string;
  hasta: string;
}

/** Cómo se movió el precio de un activo en un rango: extremos y variación, sin la serie entera. */
export async function getPriceHistory(
  ds: AssistantDataSource,
  input: PriceHistoryInput,
): Promise<ToolResult> {
  const symbol = checkSymbol(input.simbolo);
  if (!symbol.ok) return fail(symbol.error);
  const range = checkRange(input.desde, input.hasta, ds.now);
  if (!range.ok) return fail(range.error);

  const history = await ds.priceHistory(symbol.symbol, range.from);
  if (history === null) {
    return ok(
      { fn: "summarizeCloses", detail: symbol.symbol },
      { simbolo: symbol.symbol },
      {
        missing: [
          `${symbol.symbol} no está en la base de precios de la app: no tengo su historia.`,
        ],
      },
    );
  }
  const summary = summarizeCloses(history.closes, range.from, range.to);
  if (summary === null) {
    return ok(
      { fn: "summarizeCloses", detail: rangeText(range.from, range.to) },
      { simbolo: history.symbol },
      {
        missing: [
          `No hay cierres de ${history.symbol} entre ${rangeText(range.from, range.to)}.`,
        ],
      },
    );
  }

  const close = (c: { date: string; close: typeof summary.first.close }) => ({
    fecha: formatDateKey(c.date),
    precio: formatPrice(c.close, { currency: true }),
  });
  return ok(
    {
      fn: "summarizeCloses",
      detail: `${history.symbol} · ${rangeText(summary.first.date, summary.last.date)}`,
    },
    {
      simbolo: history.symbol,
      nombre: history.name,
      primer_cierre: close(summary.first),
      ultimo_cierre: close(summary.last),
      minimo: close(summary.min),
      maximo: close(summary.max),
      variacion: formatPercent(summary.change, { signed: true }),
      cierres_en_el_rango: summary.count,
    },
    {
      notes: [
        "Precios de cierre ajustados por splits, sin dividendos.",
        ...(range.clipped ? ["El rango se recortó a hoy."] : []),
      ],
    },
  );
}
