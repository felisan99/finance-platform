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

const ratio = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const wholeNumber = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const compactNumber = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Razón (P/E, P/B, beta…): siempre 2 decimales, `17,26`. */
export function formatRatio(value: Dec | null): string {
  return value === null ? EMPTY : ratio.format(text(value));
}

// Escala larga del español (RAE): 10^9 es «mil millones» y 10^12 es «billón». Se escribe con
// palabras porque «B» y «T» se leen distinto según el país; y `Intl` en es-UY mezcla criterios
// («5081,23 M» pero «12,23 mil M»).
const COMPACT_UNITS = [
  { at: 1e12, one: "billón", many: "billones" },
  { at: 1e9, one: "mil millones", many: "mil millones" },
  { at: 1e6, one: "millón", many: "millones" },
  { at: 1e3, one: "mil", many: "mil" },
] as const;

/**
 * Una cantidad grande (volumen, acciones, capitalización) en palabras: `21,24 millones`,
 * `12,23 mil millones`, `4,21 billones`. Menos de mil, el número entero. Es para mostrar: no se
 * calcula nada con lo que sale de acá.
 */
export function formatCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EMPTY;
  const abs = Math.abs(value);
  if (abs < 1000) return wholeNumber.format(value);

  let index = COMPACT_UNITS.findIndex((unit) => abs >= unit.at);
  let scaled = abs / COMPACT_UNITS[index]!.at;
  // 999.996 millones redondea a 1000 millones: es «1 mil millones». Todas las unidades van de a 1000.
  if (Math.round(scaled * 100) / 100 >= 1000 && index > 0) {
    index -= 1;
    scaled = abs / COMPACT_UNITS[index]!.at;
  }
  const rounded = Math.round(scaled * 100) / 100;
  const unit = COMPACT_UNITS[index]!;
  const sign = value < 0 ? "-" : "";
  return `${sign}${compactNumber.format(rounded)} ${rounded === 1 ? unit.one : unit.many}`;
}

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
