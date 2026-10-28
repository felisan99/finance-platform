import { buildDashboard } from "@/lib/portfolio/dashboard";
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "@/lib/portfolio/format";
import { typeLabelOf } from "@/lib/portfolio/instrument-type";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { ok } from "./shared";

/** Posiciones abiertas, efectivo y totales de hoy, valuados como en Inicio. */
export async function getPositions(
  ds: AssistantDataSource,
): Promise<ToolResult> {
  const snapshot = await ds.snapshot();
  const { valued } = snapshot;
  const dashboard = buildDashboard(valued, snapshot.transactions, ds.now);

  const open = valued.positions
    .filter((p) => p.isOpen)
    .sort((a, b) =>
      (b.marketValue ?? b.costBasis).comparedTo(a.marketValue ?? a.costBasis),
    );
  const closed = valued.positions.filter((p) => !p.isOpen);

  const missing = valued.missingPrices.map(
    (symbol) =>
      `Sin precio para ${symbol}: su valor, su peso y su ganancia no realizada no se pueden calcular, y el valor total no la incluye.`,
  );
  if (dashboard.totalGain === null && snapshot.transactions.length > 0) {
    missing.push(
      "Ganancia total: no se puede calcular (falta algún precio o no hay depósitos).",
    );
  }

  return ok(
    {
      fn: "valuePortfolio",
      detail: dashboard.oldestPriceAt
        ? `precios al ${formatDate(dashboard.oldestPriceAt)}`
        : "sin precios",
    },
    {
      portafolio: ds.scopeName,
      valor_total: formatMoney(valued.totalValue),
      valor_posiciones: formatMoney(valued.marketValue),
      efectivo: formatMoney(valued.cash),
      aportado_neto: formatMoney(dashboard.netContributed),
      ganancia_total: formatMoney(dashboard.totalGain, { signed: true }),
      ganancia_total_pct: formatPercent(dashboard.totalGainPct, {
        signed: true,
      }),
      ganancia_no_realizada: formatMoney(valued.unrealizedPnl, {
        signed: true,
      }),
      ganancia_realizada_historica: formatMoney(valued.realizedPnl, {
        signed: true,
      }),
      dividendos_historicos: formatMoney(valued.dividends),
      cambio_del_dia: formatMoney(valued.dayChange, { signed: true }),
      cambio_del_dia_pct: formatPercent(valued.dayChangePct, { signed: true }),
      posiciones: open.map((p) => ({
        simbolo: p.symbol,
        tipo: typeLabelOf(snapshot.instrumentBySymbol.get(p.symbol)?.type),
        cantidad: formatQuantity(p.quantity),
        precio: formatPrice(p.price, { currency: true }),
        precio_al: p.priceAsOf ? formatDate(p.priceAsOf) : null,
        valor: formatMoney(p.marketValue),
        peso: formatPercent(p.weight),
        costo_promedio: formatPrice(p.avgCost, { currency: true }),
        costo_base: formatMoney(p.costBasis),
        ganancia_no_realizada: formatMoney(p.unrealizedPnl, { signed: true }),
        ganancia_no_realizada_pct: formatPercent(p.unrealizedPct, {
          signed: true,
        }),
        ganancia_realizada: formatMoney(p.realizedPnl, { signed: true }),
        dividendos: formatMoney(p.dividends),
        cambio_del_dia_pct: formatPercent(p.dayChangePct, { signed: true }),
      })),
      posiciones_cerradas: closed.map((p) => ({
        simbolo: p.symbol,
        ganancia_realizada: formatMoney(p.realizedPnl, { signed: true }),
        dividendos: formatMoney(p.dividends),
      })),
    },
    {
      missing,
      notes: dashboard.negativeCash
        ? ["El efectivo es negativo: probablemente falta cargar un depósito."]
        : [],
    },
  );
}
