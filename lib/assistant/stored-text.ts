import { cleanText } from "@/lib/market-data/sanitize";

// Lo que se guarda y vuelve al prompt en otro turno (memoria, resumen de la conversación) puede
// haber pasado cerca de texto de terceros (noticias, web, datos de empresas). Un recuerdo es un
// dato corto en texto plano sobre la persona: nunca un link ni algo con forma de instrucción.

const URL_LIKE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,}/gi;
// `foo.com`, `foo.io/algo`: dominio con un TLD conocido, o cualquier `algo.xx/ruta`.
const DOMAIN_LIKE =
  /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|co|ai|app|dev|xyz|info|biz|me|ly|gg|uy|ar|es|us|uk|ru|cn|tk|top|site|online|link|click|sh|to)\b(\/\S*)?|\b[a-z0-9-]+\.[a-z]{2,}\/\S*/gi;

const LINK_PATTERNS = [URL_LIKE, MARKDOWN_LINK, EMAIL, DOMAIN_LIKE];

const INSTRUCTION_PATTERNS = [
  // Código, HTML o plantillas.
  /[`<>{}]/,
  // Marcas de rol: "system:", "assistant:", "sistema:".
  /\b(system|assistant|developer|user|tool|sistema|asistente|usuario)\s*:/i,
  // "ignore previous instructions", "ignorá las reglas", "olvidate de tus instrucciones".
  /\b(ignor\w*|disregard|olvid\w*)\b[^.]{0,40}\b(instruc\w*|reglas|rules|prompt|indicaciones)\b/i,
  /\b(previous|prior|above|new)\s+instructions\b/i,
  /\bnuevas\s+instrucciones\b/i,
  /\bsystem\s+prompt\b/i,
];

const matches = (pattern: RegExp, text: string): boolean => {
  pattern.lastIndex = 0;
  return pattern.test(text);
};

export function containsLink(text: string): boolean {
  return LINK_PATTERNS.some((pattern) => matches(pattern, text));
}

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => matches(pattern, text));
}

/** Saca links, direcciones web y emails; un link en markdown deja solo su texto. */
export function stripLinks(text: string): string {
  return text
    .replace(MARKDOWN_LINK, "$1")
    .replace(URL_LIKE, "")
    .replace(EMAIL, "")
    .replace(DOMAIN_LIKE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "");
}

/** Un recuerdo como dato de una línea entre comillas para el prompt (filas viejas incluidas). */
export function quoteStoredItem(text: string, max: number): string {
  return JSON.stringify(cleanText(text, max) ?? "");
}
