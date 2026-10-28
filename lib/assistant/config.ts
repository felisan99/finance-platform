import "server-only";

import { z } from "zod";

// Configuración del asistente desde el entorno. Falla cerrado: sin clave o sin modelo, el asistente
// queda "no disponible" en vez de intentar llamar con una configuración a medias.

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._:-]+$/;

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(20),
  ASSISTANT_MODEL: z.string().regex(MODEL_ID),
  ASSISTANT_FALLBACK_MODEL: z.string().regex(MODEL_ID).optional(),
  TAVILY_API_KEY: z.string().min(10).optional(),
});

export interface AssistantConfig {
  apiKey: string;
  model: string;
  /** `null` si no se configuró un respaldo. */
  fallbackModel: string | null;
  /** `null` si no hay clave de Tavily: el asistente no ofrece la búsqueda de noticias. */
  tavilyKey: string | null;
}

/** `null` si falta algo: la pestaña lo dice y la ruta responde 503. */
export function getAssistantConfig(
  env: Record<string, string | undefined> = process.env,
): AssistantConfig | null {
  const blankToUndefined = (value: string | undefined) =>
    value?.trim() ? value.trim() : undefined;
  const parsed = schema.safeParse({
    OPENROUTER_API_KEY: blankToUndefined(env.OPENROUTER_API_KEY),
    ASSISTANT_MODEL: blankToUndefined(env.ASSISTANT_MODEL),
    ASSISTANT_FALLBACK_MODEL: blankToUndefined(env.ASSISTANT_FALLBACK_MODEL),
    TAVILY_API_KEY: blankToUndefined(env.TAVILY_API_KEY),
  });
  if (!parsed.success) return null;
  const fallback = parsed.data.ASSISTANT_FALLBACK_MODEL ?? null;
  return {
    apiKey: parsed.data.OPENROUTER_API_KEY,
    model: parsed.data.ASSISTANT_MODEL,
    fallbackModel: fallback === parsed.data.ASSISTANT_MODEL ? null : fallback,
    tavilyKey: parsed.data.TAVILY_API_KEY ?? null,
  };
}
