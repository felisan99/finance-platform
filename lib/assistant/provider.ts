import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export interface ModelChoice {
  apiKey: string;
  model: string;
  fallbackModels: readonly string[];
}

/**
 * El modelo vía OpenRouter. Los respaldos los resuelve OpenRouter (`models`): si el principal falla
 * o llega a su límite (los gratuitos tienen límite por minuto y por día, y comparten cupo con otros
 * usuarios), prueba con el siguiente en la misma request. `require_parameters` evita que lo atienda
 * un proveedor sin tools.
 */
export function createAssistantModel(choice: ModelChoice): LanguageModel {
  const openrouter = createOpenRouter({ apiKey: choice.apiKey });
  return openrouter(choice.model, {
    models:
      choice.fallbackModels.length > 0
        ? [choice.model, ...choice.fallbackModels]
        : undefined,
    usage: { include: true },
    provider: { require_parameters: true },
  });
}

/** El costo que informa OpenRouter (`usage.cost`, en dólares), si vino. */
export function costOf(providerMetadata: unknown): number | null {
  const openrouter = (providerMetadata as Record<string, unknown> | undefined)
    ?.openrouter as Record<string, unknown> | undefined;
  const usage = openrouter?.usage as Record<string, unknown> | undefined;
  const cost = usage?.cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? cost
    : null;
}
