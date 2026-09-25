import { d } from "@/lib/engine";
import type { Quote } from "@/lib/market-data";
import { parseDecimalText } from "@/lib/validation/transaction";
import { formatDateTime, formatPrice } from "./format";

// Precio de referencia para el alta de una operación: la cotización de hoy del símbolo elegido, para
// dejarla escrita en el campo de precio (como la fecha y la hora, que arrancan en "ahora"). Puro:
// valida lo que devolvió el proveedor y lo deja listo para mostrar; la consulta es de la Server Action.

export interface ReferencePrice {
  /** Decimal plano (con punto), listo para el campo de precio del formulario. */
  price: string;
  /** `US$ 575,24`. */
  priceText: string;
  /** `25/09/2026 21:58`, hora de Montevideo: hasta cuándo es válido ese precio. */
  asOfText: string;
}

// Los mismos límites que el campo de precio del formulario (`lib/validation/transaction.ts`): lo que
// no entre ahí no se sugiere, porque el servidor lo rechazaría al guardar.
const PRICE_RULES = { maxInt: 7, maxDecimals: 8, rule: "positive" } as const;

/**
 * `null` si no hay cotización usable: sin dato, en otra moneda que no sea USD (la app es solo USD:
 * sugerir eso confundiría), con fecha inválida, o con un precio que el formulario no aceptaría.
 */
export function buildReferencePrice(
  quote: Pick<Quote, "price" | "asOf" | "currency"> | null | undefined,
): ReferencePrice | null {
  if (!quote) return null;
  if (quote.currency !== null && quote.currency !== "USD") return null;
  if (Number.isNaN(quote.asOf.getTime())) return null;

  let plain: string;
  try {
    // El proveedor ya redondea una vez; esto solo acota los decimales al máximo del formulario.
    plain = d(quote.price).toDecimalPlaces(PRICE_RULES.maxDecimals).toFixed();
  } catch {
    return null;
  }
  const parsed = parseDecimalText(plain, PRICE_RULES);
  if (!parsed.ok) return null;

  return {
    price: plain,
    priceText: `US$ ${formatPrice(parsed.value)}`,
    asOfText: formatDateTime(quote.asOf),
  };
}
