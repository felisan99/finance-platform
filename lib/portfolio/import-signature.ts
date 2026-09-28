// Firma de lo que se eligió para importar (archivo o texto pegado, y si se incluyen las parecidas).
// El navegador y el servidor la calculan igual: la vista previa que llega solo se muestra si su firma
// coincide con la de lo que hay ahora en pantalla (un archivo distinto, o cambiado, no la reutiliza).
// Sin imports: la usa un componente de cliente.

/** FNV-1a de 32 bits sobre las unidades UTF-16: barato y suficiente para notar un cambio. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Al armar un `FormData` el navegador convierte cada salto de línea del texto en CRLF (así lo manda
 * el multipart): el servidor recibe `\r\n` donde el cuadro de texto tenía `\n`. Se comparan ambos
 * con el mismo salto, o la vista previa de un texto pegado nunca coincidiría.
 */
const unifyNewlines = (text: string) => text.replace(/\r\n?/g, "\n");

export type ImportInput =
  | { kind: "file"; name: string; size: number }
  | { kind: "text"; text: string }
  | { kind: "none" };

/**
 * `portfolio` es el id del portafolio de destino: la vista previa se arma contra lo que ya hay en ese
 * portafolio, así que la de otro no sirve.
 */
export function inputSignature(
  input: ImportInput,
  includeSuspected: boolean,
  portfolio = "",
): string {
  const flag = includeSuspected ? "1" : "0";
  const target = portfolio === "" ? "" : `|${portfolio}`;
  switch (input.kind) {
    case "file":
      return `file|${input.name}|${input.size}|${flag}${target}`;
    case "text": {
      const text = unifyNewlines(input.text);
      return `text|${text.length}|${hash(text)}|${flag}${target}`;
    }
    case "none":
      return "";
  }
}
