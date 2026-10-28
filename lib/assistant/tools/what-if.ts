import { impactRows, planView } from "@/lib/portfolio/before-buy-amount";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { checkSymbol, fail, ok } from "./shared";

export const MAX_WHAT_IF_AMOUNT = 1_000_000;

export interface WhatIfInput {
  simbolo: string;
  monto: number;
}

/**
 * "¿Y si compro?": lo mismo que muestra "Antes de comprar" en el detalle del activo. Qué peso
 * tendría en la cartera con plata nueva y cómo le habría ido a un aporte mensual de ese monto.
 * No es una recomendación y no da veredictos de compra.
 */
export async function whatIf(
  ds: AssistantDataSource,
  input: WhatIfInput,
): Promise<ToolResult> {
  const symbol = checkSymbol(input.simbolo);
  if (!symbol.ok) return fail(symbol.error);
  if (
    !Number.isFinite(input.monto) ||
    input.monto < 1 ||
    input.monto > MAX_WHAT_IF_AMOUNT
  ) {
    return fail("El monto tiene que estar entre 1 y 1.000.000 dólares.");
  }

  const view = await ds.beforeBuy(symbol.symbol);
  if (view === null) {
    return ok(
      { fn: "simulateAddition", detail: symbol.symbol },
      { simbolo: symbol.symbol },
      {
        missing: [
          `No tengo precios suficientes de ${symbol.symbol} para simularlo (tiene que estar en la app, por ejemplo en la watchlist).`,
        ],
      },
    );
  }

  const amount = Math.round(input.monto);
  const impact = view.impact;
  return ok(
    {
      fn: "simulateAddition + simulateMonthlyPlan",
      detail: `${view.symbol} · cierres al ${view.asOf}`,
    },
    {
      simbolo: view.symbol,
      monto: amount,
      compra_unica_con_plata_nueva: impact
        ? impactRows(impact.model, amount).map((row) => ({
            concepto: row.label,
            antes: row.before,
            despues: row.after,
          }))
        : null,
      relacion_con_la_cartera: impact?.fit
        ? { correlacion: impact.fit.value, explicacion: impact.fit.sentence }
        : null,
      si_hubieras_aportado_por_mes: view.windows.map((window) => {
        const plan = planView(window.plan, amount);
        return {
          periodo: window.label,
          descripcion: plan.heading,
          invertido: plan.invested,
          valor_final: plan.value,
          ganancia: plan.gain.text,
          comparacion: plan.benchmark
            ? `${plan.benchmark.text} (${plan.benchmark.gain.text})`
            : null,
          peor_momento: window.worst,
          mayor_caida_del_precio: window.priceDrawdown,
        };
      }),
    },
    {
      missing:
        impact === null
          ? ["Todavía no hay cartera con la que compararlo."]
          : [],
      notes: [
        ...(impact?.notes ?? []),
        "Es una simulación con precios pasados: no predice nada y no es una recomendación de compra.",
      ],
    },
  );
}
