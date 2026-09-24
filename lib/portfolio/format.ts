import { ZERO, type Dec } from "@/lib/engine";
import { APP_TZ, formatLocal } from "./time";

// Formato de presentación (es-UY: 1.234,56). Lo único que redondea montos: el motor y la base
// trabajan con decimales exactos. Se le pasa a Intl el string decimal (no un float): así no se
// pierde ningún dígito. Un valor que se redondea a cero se muestra sin signo ("-0,00" confunde).

const LOCALE = "es-UY";
export const EMPTY = "—";

const money = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  currencyDisplay: "symbol",
});
const moneySigned = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  currencyDisplay: "symbol",
  signDisplay: "exceptZero",
});
const percent = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percentSigned = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const quantity = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
});
const price = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Un valor que redondea a cero a `dp` decimales es cero (sin "−0,00"). */
const clean = (value: Dec, dp: number): Dec =>
  value.toDecimalPlaces(dp).isZero() ? ZERO : value;

// `Intl.NumberFormat` acepta el decimal como string (sin pasar por float); TypeScript lo tipa así.
const text = (value: Dec): `${number}` => value.toFixed() as `${number}`;

/** `US$ 1.234,56`. `signed` antepone `+` o `-` (ganancias y cambios). */
export function formatMoney(
  value: Dec | null,
  options: { signed?: boolean } = {},
): string {
  if (value === null) return EMPTY;
  const formatter = options.signed ? moneySigned : money;
  return formatter.format(text(clean(value, 2)));
}

/** Fracción → porcentaje: `0.0682` → `6,82%`. */
export function formatPercent(
  fraction: Dec | null,
  options: { signed?: boolean } = {},
): string {
  if (fraction === null) return EMPTY;
  const formatter = options.signed ? percentSigned : percent;
  // Dos decimales de porcentaje = cuatro decimales de fracción.
  return formatter.format(text(clean(fraction, 4)));
}

/** Cantidad de acciones: hasta 8 decimales, sin ceros de relleno. */
export function formatQuantity(value: Dec | null): string {
  return value === null ? EMPTY : quantity.format(text(value));
}

/** El valor exacto, sin redondear a centavos (hasta 8 decimales): para contrastar contra otras fuentes. */
export const formatExact = formatQuantity;

/** Precio unitario: mínimo 2 decimales, hasta 4. */
export function formatPrice(value: Dec | null): string {
  return value === null ? EMPTY : price.format(text(value));
}

/** `09/03/2026` en hora de Montevideo. */
export const formatDate = (instant: Date): string =>
  formatLocal(instant, "dd/MM/yyyy");

/** `09/03/2026 19:34` en hora de Montevideo. */
export const formatDateTime = (instant: Date): string =>
  formatLocal(instant, "dd/MM/yyyy HH:mm");

/** `23/09`: para "precio al 23/09". */
export const formatDayMonth = (instant: Date): string =>
  formatLocal(instant, "dd/MM");

const dayHeader = new Intl.DateTimeFormat(LOCALE, {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Encabezado de un día (`miércoles, 23 de setiembre`) a partir de su clave `YYYY-MM-DD`. */
export function formatDayHeader(dateKey: string): string {
  return dayHeader.format(new Date(`${dateKey}T12:00:00Z`));
}

export { APP_TZ };

/** Diferencia entre dos rendimientos, en puntos porcentuales: `0.16` → `+16,00 pp`. */
export const formatPoints = (fraction: Dec | null): string =>
  fraction === null
    ? EMPTY
    : formatPercent(fraction, { signed: true }).replace("%", " pp");

export {
  formatChartIndex,
  formatChartMoney,
  formatDateKey,
} from "./chart-format";
