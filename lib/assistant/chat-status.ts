import type { UIMessage } from "ai";
import { TOOL_ACTIVITY, TOOL_LABELS, sourceOf } from "./tool-result";

// Qué mostrar mientras el asistente trabaja y qué fuentes usó. Puro: lo usa el chat del cliente.
//
// Mientras llega texto, el texto mismo es la señal de que avanza. Pero antes del primer token, mientras
// corre una tool y mientras el modelo "piensa" después de una tool (razonamiento que no se muestra),
// la pantalla quedaba quieta: para esos momentos hay un indicador con lo que está pasando.

const isToolPart = (part: UIMessage["parts"][number]): boolean =>
  part.type.startsWith("tool-");

const toolName = (part: UIMessage["parts"][number]): string =>
  part.type.slice("tool-".length);

const toolState = (part: UIMessage["parts"][number]): string | undefined =>
  (part as { state?: string }).state;

/**
 * El texto del indicador, o `null` si no hace falta (no está trabajando, o ya está escribiendo).
 * `busy`: la request está en curso.
 */
export function activityOf(
  messages: readonly UIMessage[],
  busy: boolean,
): string | null {
  if (!busy) return null;
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return "Pensando";

  const parts = last.parts.filter(
    (p) => p.type === "text" || p.type === "step-start" || isToolPart(p),
  );
  const current = parts.at(-1);
  if (!current) return "Pensando";
  if (current.type === "text") {
    return (current as { text: string }).text.trim() === "" ? "Pensando" : null;
  }
  if (isToolPart(current)) {
    const state = toolState(current);
    if (state === "input-streaming" || state === "input-available") {
      return TOOL_ACTIVITY[toolName(current)] ?? "Consultando tu cartera";
    }
    return "Analizando los datos";
  }
  // Empezó un paso nuevo: si antes hubo tools, está leyendo sus resultados.
  return parts.some(isToolPart) ? "Analizando los datos" : "Pensando";
}

export interface SourceLine {
  label: string;
  detail: string;
}

/** Las fuentes de una respuesta, sin repetir: de las tools que terminaron bien. */
export function sourcesOf(message: UIMessage): SourceLine[] {
  const seen = new Set<string>();
  const lines: SourceLine[] = [];
  for (const part of message.parts) {
    if (!isToolPart(part) || toolState(part) !== "output-available") continue;
    const source = sourceOf((part as { output?: unknown }).output);
    if (!source) continue;
    const line = {
      label: TOOL_LABELS[toolName(part)] ?? toolName(part),
      detail: source.detail,
    };
    const key = `${line.label}|${line.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

/** ¿El error vino de la ruta antes de empezar la respuesta (cuerpo `{ error }` con un status HTTP)? */
function isRejectedBeforeStreaming(errorMessage: string): boolean {
  try {
    const parsed: unknown = JSON.parse(errorMessage);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { error?: unknown }).error === "string"
    );
  } catch {
    return false;
  }
}

/**
 * ¿Se puede mostrar "Reintentar"? Solo si la ruta rechazó la pregunta antes de responder (límite de
 * uso, sesión, servicio caído) y todavía no hay respuesta: en ese caso el servidor no guardó nada y
 * reenviar el mismo mensaje no lo duplica. Si falló durante la respuesta (o la conexión se cortó) la
 * pregunta puede estar guardada, y reenviar el mismo id chocaría con la restricción única de
 * `assistant_messages`: ahí la persona escribe de nuevo.
 */
export function canRetry(
  messages: readonly UIMessage[],
  errorMessage: string | undefined,
): boolean {
  if (!errorMessage || messages.at(-1)?.role !== "user") return false;
  return isRejectedBeforeStreaming(errorMessage);
}

export const ANNOUNCE_BUSY = "El asistente está respondiendo…";
export const ANNOUNCE_DONE = "Respuesta lista";

/**
 * Qué anunciar a lector de pantalla cuando cambia el estado de la request. Solo transiciones, nunca
 * por token: `null` = no cambiar lo ya anunciado. Si falló, el texto del error; si terminó, "lista".
 */
export function announcementOf(
  wasBusy: boolean,
  busy: boolean,
  failure: string | null,
): string | null {
  if (!wasBusy && busy) return ANNOUNCE_BUSY;
  if (wasBusy && !busy) return failure ?? ANNOUNCE_DONE;
  return null;
}
