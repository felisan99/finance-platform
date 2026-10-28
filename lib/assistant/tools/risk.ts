import {
  computeAllocation,
  computeRisk,
  d,
  periodBase,
  type PeriodId,
} from "@/lib/engine";
import { formatDateKey } from "@/lib/portfolio/chart-format";
import { formatMoney, formatPercent } from "@/lib/portfolio/format";
import { typeLabelOf } from "@/lib/portfolio/instrument-type";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { PERIOD_NAMES } from "./performance";
import { fail, ok, rangeText } from "./shared";

/** Cuántas posiciones se nombran en la concentración. */
const TOP_POSITIONS = 5;

/** Concentración de hoy y caídas, volatilidad y mejores/peores días del período. */
export async function getRisk(
  ds: AssistantDataSource,
  input: { periodo?: PeriodId },
): Promise<ToolResult> {
  const id: PeriodId = input.periodo ?? "MAX";
  const [snapshot, performance] = await Promise.all([
    ds.snapshot(),
    ds.performance(),
  ]);
  const { valued } = snapshot;
  if (snapshot.transactions.length === 0) {
    return fail("Este portafolio no tiene operaciones.");
  }

  const byType = computeAllocation(
    valued,
    (symbol) =>
      typeLabelOf(snapshot.instrumentBySymbol.get(symbol)?.type) ?? null,
  );
  const top = valued.positions
    .filter((p) => p.isOpen && p.weight !== null)
    .sort((a, b) => b.weight!.comparedTo(a.weight!))
    .slice(0, TOP_POSITIONS);

  const missing = valued.missingPrices.map(
    (symbol) => `Sin precio para ${symbol}: no entra en la concentración.`,
  );

  let risk = null;
  let range: string | null = null;
  if (performance?.result.series.baseDate) {
    const endDate = performance.endDate;
    const { baseDate } = periodBase(
      id,
      endDate,
      performance.result.series.baseDate,
    );
    risk = computeRisk(performance.result.series.points, baseDate, endDate);
    range = rangeText(baseDate, endDate);
  }
  if (risk === null) {
    missing.push("Caídas y volatilidad: todavía no hay días con rendimiento.");
  } else if (risk.volatility === null) {
    missing.push("Volatilidad: hacen falta al menos 20 días con rendimiento.");
  }

  return ok(
    {
      fn: "computeRisk + computeAllocation",
      detail: range ? `${id} (${range})` : "composición de hoy",
    },
    {
      portafolio: ds.scopeName,
      concentracion: {
        mayores_posiciones: top.map((p) => ({
          simbolo: p.symbol,
          peso: formatPercent(p.weight),
          valor: formatMoney(p.marketValue),
        })),
        por_tipo: byType.slices.map((slice) => ({
          grupo:
            slice.kind === "cash"
              ? "Efectivo"
              : slice.kind === "unclassified"
                ? "Sin clasificar"
                : slice.key,
          peso: formatPercent(slice.weight),
        })),
      },
      periodo: risk ? { id, nombre: PERIOD_NAMES[id], fechas: range } : null,
      caida_maxima: risk?.maxDrawdown
        ? {
            profundidad: formatPercent(risk.maxDrawdown.depth),
            desde_el_maximo_del: formatDateKey(risk.maxDrawdown.peakDate),
            hasta_el_minimo_del: formatDateKey(risk.maxDrawdown.troughDate),
            recuperada_el: risk.maxDrawdown.recoveredDate
              ? formatDateKey(risk.maxDrawdown.recoveredDate)
              : "todavía no se recuperó",
          }
        : risk
          ? "sin caídas en el período"
          : null,
      distancia_al_maximo_hoy: risk
        ? formatPercent(risk.currentDrawdown)
        : null,
      volatilidad_anualizada:
        risk?.volatility != null
          ? formatPercent(d(risk.volatility.toFixed(8)))
          : null,
      mejor_dia: risk?.bestDay
        ? {
            fecha: formatDateKey(risk.bestDay.date),
            rendimiento: formatPercent(risk.bestDay.value, { signed: true }),
          }
        : null,
      peor_dia: risk?.worstDay
        ? {
            fecha: formatDateKey(risk.worstDay.date),
            rendimiento: formatPercent(risk.worstDay.value, { signed: true }),
          }
        : null,
    },
    {
      missing,
      notes: [
        "Las caídas y la volatilidad se miden sobre el rendimiento (TWR), sin el efecto de depósitos y retiros.",
      ],
    },
  );
}
