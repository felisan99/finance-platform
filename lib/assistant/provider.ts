import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export interface ModelChoice {
  apiKey: string;
  model: string;
  fallbackModel: string | null;
}

/**
 * El modelo vía OpenRouter. El respaldo lo resuelve OpenRouter (`models`): si el principal falla
 * o llega a su límite (los gratuitos tienen límite por minuto y por día), prueba con el siguiente
 * en la misma request. `require_parameters` evita que lo atienda un proveedor sin tools.
 */
export function createAssistantModel(choice: ModelChoice): LanguageModel {
  const openrouter = createOpenRouter({ apiKey: choice.apiKey });
  return openrouter(choice.model, {
    models: choice.fallbackModel
      ? [choice.model, choice.fallbackModel]
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
