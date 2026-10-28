import { computeAllocation } from "@/lib/engine";
import { groupOfInstrument } from "@/lib/portfolio/before-buy-data";
import { formatMoney, formatPercent } from "@/lib/portfolio/format";
import { typeLabelOf } from "@/lib/portfolio/instrument-type";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { checkSymbol, fail, ok } from "./shared";

export const MAX_GROUP_SYMBOLS = 20;

export interface AllocationInput {
  agrupar: "tipo" | "sector" | "simbolos";
  simbolos?: string[];
}

const GROUP_LABELS: Record<string, string> = { ETF: "ETF", CRYPTO: "Cripto" };

/**
 * Cuánto pesa cada grupo de la cartera: por tipo, por sector, o un conjunto de símbolos elegido
 * (por ejemplo, "las tecnológicas"). Así el modelo no suma pesos por su cuenta.
 */
export async function getAllocation(
  ds: AssistantDataSource,
  input: AllocationInput,
): Promise<ToolResult> {
  const snapshot = await ds.snapshot();
  const typeOf = (symbol: string) => snapshot.instrumentBySymbol.get(symbol);

  let selected: Set<string> | null = null;
  let classify: (symbol: string) => string | null;
  if (input.agrupar === "simbolos") {
    const list = input.simbolos ?? [];
    if (list.length === 0 || list.length > MAX_GROUP_SYMBOLS) {
      return fail(`Indicá entre 1 y ${MAX_GROUP_SYMBOLS} símbolos.`);
    }
    selected = new Set<string>();
    for (const raw of list) {
      const check = checkSymbol(raw);
      if (!check.ok) return fail(check.error);
      selected.add(check.symbol);
    }
    const chosen = selected;
    classify = (symbol) => (chosen.has(symbol) ? "Seleccionados" : "Resto");
  } else if (input.agrupar === "sector") {
    classify = (symbol) => {
      const row = typeOf(symbol);
      const group = row ? groupOfInstrument(row) : null;
      return group === null ? null : (GROUP_LABELS[group] ?? group);
    };
  } else {
    classify = (symbol) => typeLabelOf(typeOf(symbol)?.type) ?? null;
  }

  const allocation = computeAllocation(snapshot.valued, classify);
  const label = (slice: (typeof allocation.slices)[number]) =>
    slice.kind === "cash"
      ? "Efectivo"
      : slice.kind === "unclassified"
        ? "Sin clasificar"
        : slice.key;

  const missing = allocation.missingPrices.map(
    (symbol) => `Sin precio para ${symbol}: no entra en el reparto.`,
  );
  if (selected) {
    const open = new Set(
      snapshot.valued.positions.filter((p) => p.isOpen).map((p) => p.symbol),
    );
    for (const symbol of selected) {
      if (!open.has(symbol)) missing.push(`${symbol} no está en la cartera.`);
    }
  }

  return ok(
    {
      fn: "computeAllocation",
      detail:
        input.agrupar === "simbolos"
          ? `peso conjunto de ${[...(selected ?? [])].join(", ")}`
          : `por ${input.agrupar}`,
    },
    {
      portafolio: ds.scopeName,
      total: formatMoney(allocation.total),
      grupos: allocation.slices.map((slice) => ({
        grupo: label(slice),
        valor: formatMoney(slice.value),
        peso: formatPercent(slice.weight),
        simbolos: slice.symbols,
      })),
      ...(selected
        ? {
            por_simbolo: snapshot.valued.positions
              .filter(
                (p) =>
                  selected.has(p.symbol) && p.isOpen && p.marketValue !== null,
              )
              .map((p) => ({
                simbolo: p.symbol,
                peso: formatPercent(p.weight),
              })),
          }
        : {}),
    },
    {
      missing,
      notes: [
        "Los pesos son sobre el total de la cartera con el efectivo incluido.",
      ],
    },
  );
}
