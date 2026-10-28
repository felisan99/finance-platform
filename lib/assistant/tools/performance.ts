import {
  PERIOD_IDS,
  computeTwr,
  type PeriodId,
  type PeriodResult,
} from "@/lib/engine";
import { benchmarkLabel } from "@/lib/portfolio/benchmarks";
import { formatDateKey } from "@/lib/portfolio/chart-format";
import {
  formatMoney,
  formatPercent,
  formatPoints,
} from "@/lib/portfolio/format";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { contributionOf } from "./explain-move";
import { checkRange, fail, ok, rangeText, startCloseOf } from "./shared";

export const PERIOD_NAMES: Record<PeriodId, string> = {
  "1S": "última semana",
  "1M": "último mes",
  "3M": "últimos 3 meses",
  YTD: "en lo que va del año",
  "1A": "último año",
  MAX: "todo el historial",
};

export interface PerformanceInput {
  periodo?: PeriodId;
  desde?: string;
  hasta?: string;
}

/**
 * Rendimiento ponderado por tiempo (TWR), tasa interna de retorno (XIRR), ganancia en dinero y
 * comparación con el benchmark para los períodos de Inicio; o TWR y ganancia de un rango libre.
 */
export async function getPerformance(
  ds: AssistantDataSource,
  input: PerformanceInput,
): Promise<ToolResult> {
  const performance = await ds.performance();
  if (performance === null) {
    return fail(
      "Todavía no hay operaciones o precios para calcular el rendimiento.",
    );
  }
  const { result } = performance;
  const benchmark = benchmarkLabel((await ds.snapshot()).benchmarkSymbol);
  const missing = result.warnings.flatMap((warning) => {
    switch (warning.code) {
      case "UNPRICED_POSITION":
        return [
          `Hubo días sin precio para ${warning.symbols.join(", ")}: esos días se valuaron a costo.`,
        ];
      case "NO_BENCHMARK":
        return [`No hay precios de ${benchmark} para comparar.`];
      default:
        return [];
    }
  });

  if (input.desde || input.hasta) {
    if (!input.desde || !input.hasta) {
      return fail("Para un rango hacen falta las dos fechas, desde y hasta.");
    }
    const range = checkRange(input.desde, input.hasta, ds.now);
    if (!range.ok) return fail(range.error);
    const to = range.to > performance.endDate ? performance.endDate : range.to;
    if (range.from > to) return fail("No hay precios para ese rango todavía.");

    const base = startCloseOf(range.from);
    const { twr, days } = computeTwr(result.series.points, base, to);
    const contribution = contributionOf(
      await ds.snapshot(),
      performance,
      range.from,
      to,
    );
    if (twr === null)
      missing.push("TWR: no hay días con rendimiento en ese rango.");
    return ok(
      { fn: "computeTwr", detail: rangeText(range.from, to) },
      {
        portafolio: ds.scopeName,
        periodo: rangeText(range.from, to),
        rendimiento_twr: formatPercent(twr, { signed: true }),
        dias_con_rendimiento: days,
        ganancia_en_dinero: contribution
          ? formatMoney(contribution.gain, { signed: true })
          : null,
      },
      {
        missing,
        notes: [
          `Para rangos libres no se calcula la comparación con ${benchmark} ni el XIRR: están en los períodos fijos (${PERIOD_IDS.join(", ")}).`,
        ],
      },
    );
  }

  const periods: PeriodResult[] = input.periodo
    ? result.periods.filter((p) => p.id === input.periodo)
    : result.periods;
  if (periods.length === 0) return fail("Período desconocido.");

  return ok(
    {
      fn: "computeTwr + computeXirr",
      detail:
        periods.length === 1
          ? `${periods[0]!.id} (${rangeText(periods[0]!.startDate, periods[0]!.endDate)})`
          : `todos los períodos al ${formatDateKey(performance.endDate)}`,
    },
    {
      portafolio: ds.scopeName,
      benchmark,
      periodos: periods.map((p) => ({
        periodo: p.id,
        nombre: PERIOD_NAMES[p.id],
        desde: formatDateKey(p.startDate),
        hasta: formatDateKey(p.endDate),
        recortado_al_inicio_del_historial: p.truncated,
        rendimiento_twr: formatPercent(p.twr, { signed: true }),
        twr_anualizado: p.twrAnnualized
          ? formatPercent(p.twrAnnualized, { signed: true })
          : null,
        xirr_anual: formatPercent(p.xirr, { signed: true }),
        benchmark: formatPercent(p.benchmarkReturn, { signed: true }),
        diferencia_con_benchmark: formatPoints(p.difference),
        ganancia_en_dinero: formatMoney(p.gain, { signed: true }),
      })),
    },
    {
      missing: [
        ...missing,
        ...periods
          .filter((p) => p.xirr === null)
          .map((p) =>
            p.days < 30
              ? `XIRR de ${p.id}: no se calcula en períodos de menos de 30 días.`
              : `XIRR de ${p.id}: no se pudo calcular.`,
          ),
      ],
      notes: [
        "TWR mide la estrategia sin el efecto de cuándo se depositó; XIRR es la tasa anual de la plata puesta, con sus fechas.",
      ],
    },
  );
}
