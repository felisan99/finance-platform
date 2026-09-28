// Cómo se llama cada tipo de instrumento en la app. Sin imports: lo usan componentes de cliente
// (el buscador de símbolos) y del servidor.

export type TypeLabel = "Acción" | "ETF" | "Cripto";

/** El tipo como lo muestra la app; lo que no es ETF ni cripto se llama "Acción". `null` sin tipo. */
export function typeLabelOf(type: string | null | undefined): TypeLabel | null {
  if (type === null || type === undefined) return null;
  if (type === "ETF") return "ETF";
  if (type === "CRYPTO") return "Cripto";
  return "Acción";
}
