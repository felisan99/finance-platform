// Formatos para gráficos y fechas de calendario. Sin imports a propósito: lo usan también los
// componentes de cliente y no tiene que arrastrar el motor (decimal.js) al navegador. Reciben el
// `number` que dibuja Recharts: los gráficos no calculan ni guardan nada con esos números.

const LOCALE = "es-UY";

const chartMoney = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  currencyDisplay: "symbol",
});
const chartIndex = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatChartMoney = (value: number): string =>
  chartMoney.format(value);
export const formatChartIndex = (value: number): string =>
  chartIndex.format(value);

/** `2026-09-23` → `23/09/2026`: una fecha de calendario (día de mercado), sin zona horaria de por medio. */
export const formatDateKey = (key: string): string =>
  `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;

/** `2026-09-23` → `23/09` (eje de un gráfico). */
export const formatDayMonthKey = (key: string): string =>
  `${key.slice(8, 10)}/${key.slice(5, 7)}`;

const tickFormats = new Map<number, Intl.NumberFormat>();
/** Marca de un eje con la cantidad de decimales que pide la escala. */
export function formatChartTick(value: number, decimals: number): string {
  let format = tickFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: false,
    });
    tickFormats.set(decimals, format);
  }
  return format.format(value);
}

const chartMoneySigned = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  currencyDisplay: "symbol",
  signDisplay: "exceptZero",
});
/** Dinero con signo para un tooltip: `+US$ 320,00`, `-US$ 52,00`, `US$ 0,00`. */
export const formatChartMoneySigned = (value: number): string =>
  chartMoneySigned.format(value);

const chartPercentSigned = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
/** Puntos porcentuales ya multiplicados por 100 (5,06 = 5,06 %) con signo: `+5,06%`. */
export const formatChartPercent = (value: number): string =>
  `${chartPercentSigned.format(value)}%`;
