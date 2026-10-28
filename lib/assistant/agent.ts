import {
  isStepCount,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type StreamTextEndEvent,
  type ToolSet,
} from "ai";
import { MEMORY_TOOL, NEWS_TOOL } from "./tools";

/** Tope de pasos por pregunta: cada paso es una request al modelo. */
export const MAX_STEPS = 6;

export interface AssistantRunInput {
  model: LanguageModel;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  abortSignal?: AbortSignal;
  onEnd?: (event: StreamTextEndEvent<ToolSet>) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

/**
 * El loop del agente: el modelo elige tools hasta responder o hasta `MAX_STEPS`. Lo comparten la
 * ruta de la app y los evals.
 *
 * Después de leer noticias (contenido de terceros), la memoria deja de estar disponible por el
 * resto del turno: un texto externo no puede terminar guardado como un "dato de la persona".
 */
export function runAssistant(input: AssistantRunInput) {
  const allTools = Object.keys(input.tools);
  return streamText({
    model: input.model,
    instructions: input.instructions,
    messages: input.messages,
    tools: input.tools,
    stopWhen: isStepCount(MAX_STEPS),
    temperature: 0.2,
    maxOutputTokens: 2000,
    abortSignal: input.abortSignal,
    prepareStep: ({ steps }) => {
      const readNews = steps.some((step) =>
        step.toolCalls.some((call) => call.toolName === NEWS_TOOL),
      );
      return readNews && allTools.includes(MEMORY_TOOL)
        ? { activeTools: allTools.filter((name) => name !== MEMORY_TOOL) }
        : {};
    },
    onEnd: input.onEnd,
    onError: input.onError ? ({ error }) => input.onError?.(error) : undefined,
  });
}
