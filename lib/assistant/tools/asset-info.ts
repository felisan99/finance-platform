import { d } from "@/lib/engine";
import { buildCompanyRows } from "@/lib/portfolio/company-view";
import { buildEarningsView } from "@/lib/portfolio/earnings-view";
import {
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPrice,
} from "@/lib/portfolio/format";
import { typeLabelOf } from "@/lib/portfolio/instrument-type";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { checkSymbol, fail, ok } from "./shared";

export interface AssetInfoInput {
  simbolo: string;
}

const SOURCE = "Yahoo Finance";

/**
 * Cotización de hoy y datos de la empresa o del fondo de CUALQUIER activo (no hace falta que esté
 * en la cartera ni en la base). Todo llega formateado con las mismas vistas que la ficha del activo
 * («Datos de la empresa», «Ganancias»); lo que el proveedor no da va a `missing`.
 */
export async function getAssetInfo(
  ds: AssistantDataSource,
  input: AssetInfoInput,
): Promise<ToolResult> {
  const symbol = checkSymbol(input.simbolo);
  if (!symbol.ok) return fail(symbol.error);
  const s = symbol.symbol;

  const result = await ds.assetInfo(s);
  if (result.status === "limited") {
    return fail(
      "Se alcanzó el límite de consultas de precios por minuto. Probá de nuevo en un rato.",
    );
  }
  if (result.status === "not_found") {
    return ok(
      { fn: SOURCE, detail: s },
      { simbolo: s },
      {
        missing: [
          `No encontré ${s} como acción, ETF o cripto. Revisá el símbolo (las cripto van como BTC-USD).`,
        ],
      },
    );
  }
  if (result.status === "unavailable") {
    return ok(
      { fn: SOURCE, detail: s },
      { simbolo: s },
      {
        missing: [
          `No pude obtener los datos de ${s} en este momento: el proveedor no respondió.`,
        ],
      },
    );
  }

  const { info } = result;
  const missing: string[] = [];
  const notes: string[] = [];

  // La app es solo en dólares: un precio en otra moneda formateado como US$ sería un dato falso.
  const foreign =
    info.quote?.currency != null && info.quote.currency !== "USD"
      ? info.quote.currency
      : info.company?.currency != null && info.company.currency !== "USD"
        ? info.company.currency
        : null;
  if (foreign !== null) {
    missing.push(
      `${s} cotiza en ${foreign}: solo puedo mostrar precios en dólares.`,
    );
  }
  const quote = foreign === null ? info.quote : null;
  const company = foreign === null ? info.company : null;

  if (quote === null && foreign === null) {
    missing.push(`No pude obtener la cotización de hoy de ${s}.`);
  }
  if (company === null && foreign === null) {
    missing.push(
      `No pude obtener los datos de la empresa o del fondo de ${s}.`,
    );
  }

  const earnings = company ? buildEarningsView(company, ds.now) : null;
  if (company?.kind === "stock" && earnings === null) {
    missing.push(`No hay resultados trimestrales publicados de ${s}.`);
  }
  if (company?.kind === "etf") {
    missing.push(
      "El costo anual del fondo (TER o expense ratio) no lo informa el proveedor.",
    );
  }

  const asOf = quote ? formatDateTime(quote.asOf) : null;
  if (asOf) notes.push("La hora de la cotización es la de Montevideo.");
  notes.push(
    "Datos de mercado del proveedor: pueden tener demora de unos minutos.",
  );

  return ok(
    { fn: SOURCE, detail: asOf ? `${s} · ${asOf}` : s },
    {
      simbolo: s,
      nombre: info.name,
      tipo: typeLabelOf(info.type),
      sector: info.sector,
      industria: info.industry,
      precio: quote ? formatPrice(d(quote.price), { currency: true }) : null,
      cambio_del_dia:
        quote?.changePct != null
          ? formatPercent(d(quote.changePct), { signed: true })
          : null,
      cambio_del_dia_usd:
        quote?.change != null
          ? formatMoney(d(quote.change), { signed: true })
          : null,
      cotizacion_al: asOf,
      datos: company
        ? Object.fromEntries(
            buildCompanyRows(company).map((row) => [row.label, row.value]),
          )
        : {},
      ultimos_trimestres: earnings?.bars.map((bar) => bar.summary) ?? [],
      proximos_resultados: earnings?.nextText ?? null,
    },
    { missing, notes },
  );
}
