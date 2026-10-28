import { z } from "zod";
import { cleanText } from "@/lib/market-data/sanitize";

// Noticias con Tavily. Todo lo que devuelve es entrada no confiable: se valida con Zod, se limpia
// (una línea, sin controles ni HTML, recortado) y llega al modelo marcado como contenido externo.
// A Tavily solo se le manda el texto de búsqueda que arma la tool (símbolo o empresa), nunca
// montos ni posiciones.

const ENDPOINT = "https://api.tavily.com/search";
const TIMEOUT_MS = 8000;
export const MAX_NEWS = 5;
const MAX_SNIPPET = 400;

export interface NewsItem {
  title: string;
  url: string;
  /** `YYYY-MM-DD` si Tavily la informa. */
  publishedAt: string | null;
  /** El dominio, para citar la fuente. */
  site: string;
  snippet: string;
}

export interface NewsSearch {
  search(query: string, days: number): Promise<NewsItem[]>;
}

const resultSchema = z.object({
  title: z.unknown(),
  url: z.unknown(),
  content: z.unknown().optional(),
  published_date: z.unknown().optional(),
});
const responseSchema = z.object({
  results: z.array(z.unknown()).max(50),
});

const HTML_TAG = /<[^>]*>/g;

/** Solo `https` y sin credenciales en la URL: es un link que la UI va a mostrar. */
function safeUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function dateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Valida y limpia la respuesta cruda; descarta lo que no cumpla en vez de fallar entera. */
export function parseTavilyResponse(raw: unknown): NewsItem[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return [];
  const items: NewsItem[] = [];
  for (const entry of parsed.data.results) {
    const result = resultSchema.safeParse(entry);
    if (!result.success) continue;
    const url = safeUrl(result.data.url);
    const title = cleanText(
      typeof result.data.title === "string"
        ? result.data.title.replace(HTML_TAG, " ")
        : null,
      200,
    );
    if (!url || !title) continue;
    const snippet =
      cleanText(
        typeof result.data.content === "string"
          ? result.data.content.replace(HTML_TAG, " ")
          : null,
        MAX_SNIPPET,
      ) ?? "";
    items.push({
      title,
      url: url.toString(),
      publishedAt: dateKey(result.data.published_date),
      site: url.hostname.replace(/^www\./, ""),
      snippet,
    });
    if (items.length === MAX_NEWS) break;
  }
  return items;
}

export function createTavilySearch(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): NewsSearch {
  return {
    async search(query, days) {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          topic: "news",
          days,
          max_results: MAX_NEWS,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
          include_images: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`tavily: HTTP ${response.status}`);
      return parseTavilyResponse(await response.json());
    },
  };
}
