import {
  combineContributions,
  contributionBetween,
  type ContributionResult,
} from "@/lib/engine";
import { formatDateKey } from "@/lib/portfolio/chart-format";
import { formatMoney } from "@/lib/portfolio/format";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import type { AssembledPerformance } from "@/lib/portfolio/performance-build";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { checkRange, fail, ok, rangeText, startCloseOf } from "./shared";

/** Filas con nombre; el resto se agrupa para no inundar al modelo. */
const MAX_ROWS = 10;

/**
 * La contribución de cada posición entre el cierre anterior a `from` y el de `to`, cuenta por
 * cuenta y sumada (con los mismos cierres que el gráfico de Inicio).
 */
export function contributionOf(
  snapshot: PortfolioSnapshot,
  performance: AssembledPerformance,
  from: string,
  to: string,
): ContributionResult | null {
  return combineContributions(
    snapshot.parts.map((part) =>
      contributionBetween({
        transactions: part.transactions,
        closes: performance.closes,
        from: startCloseOf(from),
        to,
        options: { currency: part.portfolio.account.currency },
      }),
    ),
  );
}

export interface ExplainMoveInput {
  desde: string;
  hasta: string;
}

/** Qué posiciones hicieron subir o bajar la cartera en un rango. */
export async function explainMove(
  ds: AssistantDataSource,
  input: ExplainMoveInput,
): Promise<ToolResult> {
  const range = checkRange(input.desde, input.hasta, ds.now);
  if (!range.ok) return fail(range.error);

  const [snapshot, performance] = await Promise.all([
    ds.snapshot(),
    ds.performance(),
  ]);
  if (performance === null) {
    return fail("Todavía no hay operaciones o precios para calcular esto.");
  }
  const to = range.to > performance.endDate ? performance.endDate : range.to;
  if (range.from > to) {
    return fail("No hay precios para ese rango todavía.");
  }
  const result = contributionOf(snapshot, performance, range.from, to);
  if (result === null) {
    return fail("Este portafolio no tiene operaciones.");
  }

  const named = result.symbols.slice(0, MAX_ROWS);
  const rest = result.symbols.slice(MAX_ROWS);
  const notes: string[] = [];
  if (to !== range.to || range.clipped) {
    notes.push(
      `El rango termina el ${formatDateKey(to)}: es el último día con precios.`,
    );
  }
  if (rest.length > 0) {
    notes.push(
      `Hay ${rest.length} posiciones más con contribuciones menores: ${rest.map((r) => r.symbol).join(", ")}.`,
    );
  }

  return ok(
    { fn: "contributionBetween", detail: rangeText(range.from, to) },
    {
      portafolio: ds.scopeName,
      periodo: rangeText(range.from, to),
      valor_inicial: formatMoney(result.startValue),
      valor_final: formatMoney(result.endValue),
      depositos_menos_retiros: formatMoney(result.externalFlows, {
        signed: true,
      }),
      ganancia_del_periodo: formatMoney(result.gain, { signed: true }),
      contribuciones: named.map((row) => ({
        simbolo: row.symbol,
        contribucion: formatMoney(row.contribution, { signed: true }),
        valor_inicial: formatMoney(row.startValue),
        valor_final: formatMoney(row.endValue),
        compras_menos_ventas_y_cobros: formatMoney(row.cashFlow.neg(), {
          signed: true,
        }),
      })),
      intereses_comisiones_impuestos: formatMoney(result.other, {
        signed: true,
      }),
    },
    {
      missing: result.unpriced.map(
        (symbol) =>
          `Sin precio para ${symbol} en alguna punta del rango: se valuó a su costo, así que su contribución puede no ser real.`,
      ),
      notes: [
        "La contribución de cada activo ya descuenta lo que se compró o vendió en el período: es lo que ganó o perdió.",
        ...notes,
      ],
    },
  );
}
