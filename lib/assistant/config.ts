import "server-only";

import { z } from "zod";

// Configuración del asistente desde el entorno. Falla cerrado: sin clave o sin modelo, el asistente
// queda "no disponible" en vez de intentar llamar con una configuración a medias.

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._:-]+$/;
/** OpenRouter prueba el principal y los respaldos en orden, en la misma request. */
export const MAX_FALLBACKS = 2;

const schema = z.object({
  OPENROUTER_API_KEY: z.string().min(20),
  ASSISTANT_MODEL: z.string().regex(MODEL_ID),
  // Uno o varios ids separados por comas.
  ASSISTANT_FALLBACK_MODEL: z
    .string()
    .transform((value) => [
      ...new Set(
        value
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.string().regex(MODEL_ID)).max(MAX_FALLBACKS))
    .optional(),
  TAVILY_API_KEY: z.string().min(10).optional(),
});

export interface AssistantConfig {
  apiKey: string;
  model: string;
  /** Respaldos en orden (vacío si no hay). Los gratuitos comparten cupo y a veces devuelven 429. */
  fallbackModels: string[];
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
  const model = parsed.data.ASSISTANT_MODEL;
  return {
    apiKey: parsed.data.OPENROUTER_API_KEY,
    model,
    fallbackModels: (parsed.data.ASSISTANT_FALLBACK_MODEL ?? []).filter(
      (id) => id !== model,
    ),
    tavilyKey: parsed.data.TAVILY_API_KEY ?? null,
  };
}
