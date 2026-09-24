/**
 * Lo que devuelve un proveedor externo es entrada no confiable que termina en tablas leídas por
 * todos los usuarios: se limpia antes de guardarlo.
 */

// Controles (\p{Cc}, incluye saltos de línea y tabulaciones), formato invisible (\p{Cf}: ancho
// cero, marcas bidireccionales, BOM) y separadores de línea o párrafo Unicode (\p{Zl}, \p{Zp}).
// Con `new RegExp`: el target de TypeScript es ES2017 y no admite `\p{…}` en un literal.
const INVISIBLE_OR_CONTROL = new RegExp(
  String.raw`[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]`,
  "gu",
);

/** Texto de una sola línea, sin caracteres de control y de a lo sumo `max` caracteres; vacío → null. */
export function cleanText(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(INVISIBLE_OR_CONTROL, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return null;
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}
