// Sin imports: el cliente lo usa y no debe arrastrar decimal.js.

/** Texto de la confirmación de "Agregar los N". */
export function addAllConfirmationText(
  count: number,
  totalNet: string,
): string {
  const noun = count === 1 ? "dividendo" : "dividendos";
  return `Se van a guardar ${count} ${noun} (${totalNet} netos de retención), cada uno con su retención como impuesto.`;
}

/** Texto de la confirmación de "Descartar" (una propuesta o varias). */
export const DISMISS_CONFIRMATION_TEXT =
  "No se va a volver a proponer este dividendo.";
