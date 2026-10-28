import type { UIMessage } from "ai";

// Qué mensajes van al modelo y cuáles se guardan en un turno. Puro: lo usa la ruta del asistente.
//
// "Reintentar" reenvía la misma pregunta con el mismo id. Si el intento anterior falló durante la
// respuesta, la ruta ya guardó la pregunta (sin respuesta): no se le manda dos veces al modelo y al
// guardar no se duplica (`appendMessages` ignora un `ui_id` que ya está en la conversación).

/**
 * El historial del turno: lo guardado más la pregunta nueva. Si lo último guardado ya es esta misma
 * pregunta (un reintento después de una falla), no se agrega otra vez: se usa la copia guardada, que
 * es la que queda en la conversación.
 */
export function historyWithQuestion(
  stored: readonly UIMessage[],
  question: UIMessage,
): UIMessage[] {
  const last = stored.at(-1);
  if (last && last.role === "user" && last.id === question.id) {
    return [...stored];
  }
  return [...stored, question];
}

/**
 * Lo que hay que guardar al terminar: desde la pregunta (último mensaje de `history`) en adelante. Si
 * el turno falló o no terminó a tiempo (`finalMessages` nulo), solo la pregunta. La pregunta puede
 * estar ya guardada (reintento): `appendMessages` la ignora y guarda solo la respuesta.
 */
export function messagesToPersist(
  finalMessages: readonly UIMessage[] | null,
  history: readonly UIMessage[],
  question: UIMessage,
): UIMessage[] {
  return finalMessages ? finalMessages.slice(history.length - 1) : [question];
}
