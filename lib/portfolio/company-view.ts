import { d } from "@/lib/engine";
import type { CompanyData } from "@/lib/market-data";
import {
  formatCompact,
  formatMoney,
  formatPercent,
  formatPrice,
  formatRatio,
} from "./format";

// Datos de la empresa (o del fondo) de la ficha de un activo: filas ya formateadas para mostrar.
// Puro: recibe lo que armó el proveedor y no toca la red ni la hora. Un dato que falta no deja una
// fila vacía: la fila no se muestra (Yahoo saca campos sin aviso).

export interface StatRow {
  label: string;
  value: string;
}

/** `US$ 342,36`: precio por acción (2 a 4 decimales; un precio bajo no pierde precisión). */
const usd = (value: string | null): string | null =>
  value === null ? null : `US$ ${formatPrice(d(value))}`;

/** `US$ 19,93`: por acción y por año (BPA, dividendo, valor contable), a centavos como en Delta. */
const usdCents = (value: string | null): string | null =>
  value === null ? null : formatMoney(d(value));

const ratioText = (value: string | null): string | null =>
  value === null ? null : formatRatio(d(value));

const percentText = (value: string | null): string | null =>
  value === null ? null : formatPercent(d(value));

const compactText = (value: number | null): string | null =>
  value === null ? null : formatCompact(value);

const usdCompact = (value: number | null): string | null =>
  value === null ? null : `US$ ${formatCompact(value)}`;

/** `US$ 235,84 – 408,61`; sin uno de los dos extremos no hay rango. */
const rangeText = (low: string | null, high: string | null): string | null =>
  low === null || high === null
    ? null
    : `US$ ${formatPrice(d(low))} – ${formatPrice(d(high))}`;

/** Las filas de la tarjeta «Datos de la empresa»; `null` si no hay ninguna que mostrar. */
export function buildCompanyRows(data: CompanyData): StatRow[] {
  const rows: StatRow[] = [];
  const add = (label: string, value: string | null) => {
    if (value !== null) rows.push({ label, value });
  };

  add("Cierre anterior", usd(data.previousClose));
  add("Apertura", usd(data.open));
  add("Rango del día", rangeText(data.dayLow, data.dayHigh));
  add(
    "Rango de 52 semanas",
    rangeText(data.fiftyTwoWeekLow, data.fiftyTwoWeekHigh),
  );
  add("Volumen", compactText(data.volume));
  add("Volumen promedio (3 meses)", compactText(data.averageVolume));

  // Una moneda no tiene P/E, dividendos ni acciones: su tamaño es la capitalización.
  if (data.kind === "crypto") {
    add("Capitalización", usdCompact(data.marketCap));
    return rows;
  }

  if (data.kind === "etf") {
    add("P/E (12 meses)", ratioText(data.trailingPE));
    add("Rentabilidad por dividendo", percentText(data.dividendYield));
    add("Patrimonio total", usdCompact(data.totalAssets));
    add("Valor de la cuota (NAV)", usd(data.navPrice));
    add("Categoría", data.category);
    add("Retorno en el año", percentText(data.ytdReturn));
    return rows;
  }

  add("Capitalización bursátil", usdCompact(data.marketCap));
  add("P/E (12 meses)", ratioText(data.trailingPE));
  add("P/E (próximos 12 meses)", ratioText(data.forwardPE));
  add("BPA (12 meses)", usdCents(data.epsTrailing));
  add("Dividendo anual", usdCents(data.dividendRate));
  add("Rentabilidad por dividendo", percentText(data.dividendYield));
  add("Acciones en circulación", compactText(data.sharesOutstanding));
  add("Acciones flotantes", compactText(data.floatShares));
  add("P/B (precio / valor contable)", ratioText(data.priceToBook));
  add("Valor contable por acción", usdCents(data.bookValue));
  add("Precio / ventas", ratioText(data.priceToSales));
  add("Beta", ratioText(data.beta));
  return rows;
}
