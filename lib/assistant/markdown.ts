// Un subconjunto chico de markdown para las respuestas del asistente: párrafos, listas, títulos,
// tablas, separadores, negrita, código en línea y links. Sin imports (lo usa el cliente) y sin HTML: la salida son
// tokens que React renderiza como texto, así un texto del modelo (o de una noticia que el modelo
// repita) nunca se interpreta como HTML. Solo se enlazan URLs `https`.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "heading"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/;

/** `| a | b |` → celdas, sin los bordes. */
const cellsOf = (line: string): Inline[][] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));
// Link markdown, negrita, código o URL suelta (en ese orden de prioridad).
const INLINE =
  /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,2000})\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`|(https:\/\/[^\s)<>\]]{1,2000})/g;

/** `https:` y sin credenciales; si no, `null` (se muestra como texto). */
function safeHref(raw: string): string | null {
  // Un punto o coma al final de una URL suelta suele ser puntuación de la oración.
  const trimmed = raw.replace(/[.,;:!?]+$/, "");
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (inline: Inline) => {
    const prev = out.at(-1);
    if (inline.kind === "text" && prev?.kind === "text")
      prev.text += inline.text;
    else if (inline.kind !== "text" || inline.text) out.push(inline);
  };
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    push({ kind: "text", text: text.slice(last, index) });
    const [whole, linkText, linkHref, strong, code, bare] = match;
    if (linkText !== undefined && linkHref !== undefined) {
      const href = safeHref(linkHref);
      push(
        href
          ? { kind: "link", text: linkText, href }
          : { kind: "text", text: linkText },
      );
    } else if (strong !== undefined) {
      push({ kind: "strong", text: strong });
    } else if (code !== undefined) {
      push({ kind: "code", text: code });
    } else if (bare !== undefined) {
      const href = safeHref(bare);
      const shown = bare.replace(/[.,;:!?]+$/, "");
      push(
        href
          ? { kind: "link", text: shown, href }
          : { kind: "text", text: shown },
      );
      push({ kind: "text", text: bare.slice(shown.length) });
    } else {
      push({ kind: "text", text: whole });
    }
    last = index + whole.length;
  }
  push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({
        kind: "paragraph",
        inlines: parseInline(paragraph.join(" ")),
      });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ...list });
      list = null;
    }
  };
  let table: string[] = [];
  const flushTable = () => {
    if (table.length === 0) return;
    const [head, ...rest] = table;
    const body = rest.filter((line) => !TABLE_SEPARATOR.test(line));
    // Una sola fila suelta con barras no es una tabla: se muestra como texto.
    if (body.length === 0 && rest.length === 0) {
      paragraph.push(head!.trim());
    } else {
      const header = cellsOf(head!);
      blocks.push({
        kind: "table",
        header,
        rows: body.map((line) => {
          const cells = cellsOf(line);
          // Filas con más o menos celdas que el encabezado: se completan o se recortan.
          return header.map((_, i) => cells[i] ?? []);
        }),
      });
    }
    table = [];
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (TABLE_ROW.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }
    flushTable();
    if (RULE.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "rule" });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const heading = HEADING.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1]!.trim()));
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        inlines: parseInline(heading[1]!.trim()),
      });
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushTable();
  flushParagraph();
  flushList();
  return blocks;
}
