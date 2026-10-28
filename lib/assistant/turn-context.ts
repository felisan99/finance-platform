import type { StoredMessage } from "./compaction";
import type { Conversation } from "./conversation-store";
import type { MemoryItem } from "./memory";

export type AssistantLimitKey = "assistant_message" | "assistant_daily";

/** Las lecturas de un turno, inyectadas: en la ruta son la base (RLS); en los tests, fakes. */
export interface TurnContextDeps<Scope> {
  takeLimit: (key: AssistantLimitKey) => Promise<boolean>;
  getConversation: () => Promise<Conversation | null>;
  getScope: () => Promise<Scope | null>;
  loadMessages: (conversation: Conversation) => Promise<StoredMessage[]>;
  listMemories: () => Promise<MemoryItem[]>;
}

export type TurnContext<Scope> =
  | { ok: false; reason: "rate_limited" | "no_conversation" | "no_portfolio" }
  | {
      ok: true;
      conversation: Conversation;
      scope: Scope;
      stored: StoredMessage[];
      memories: MemoryItem[];
    };

// Una lectura que puede quedar sin esperar (pedido rechazado antes): su error no debe quedar como
// "unhandled rejection". Quien la espera después igual recibe el error.
function background<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

/**
 * Lo que necesita un turno antes de llamar al modelo, con las lecturas independientes en paralelo.
 *
 * - Los dos límites se toman en serie y en el mismo orden que antes: `assistant_daily` solo se
 *   cuenta si pasó `assistant_message`. Deciden primero: si rechazan, el resultado es
 *   `rate_limited` aunque una lectura haya fallado, y no devuelve ningún dato.
 * - Mientras tanto corren las lecturas (solo `select` bajo RLS, sin efectos): conversación,
 *   portafolio, memoria y, en cuanto llega la conversación, sus mensajes.
 * - Los rechazos se evalúan en el orden de siempre: límites, conversación (`no_conversation`),
 *   portafolio (`no_portfolio`). Un error de lectura lanza, como antes, salvo que un rechazo
 *   anterior ya decida la respuesta.
 */
export async function loadTurnContext<Scope>(
  deps: TurnContextDeps<Scope>,
): Promise<TurnContext<Scope>> {
  const limits = (async () =>
    (await deps.takeLimit("assistant_message")) &&
    (await deps.takeLimit("assistant_daily")))();

  const conversation = background(deps.getConversation());
  const scope = background(deps.getScope());
  const stored = background(
    conversation.then((found) => (found ? deps.loadMessages(found) : [])),
  );
  const memories = background(deps.listMemories());

  if (!(await limits)) return { ok: false, reason: "rate_limited" };

  const [foundConversation, foundScope] = await Promise.all([
    conversation,
    scope,
  ]);
  if (!foundConversation) return { ok: false, reason: "no_conversation" };
  if (!foundScope) return { ok: false, reason: "no_portfolio" };

  const [storedMessages, memoryItems] = await Promise.all([stored, memories]);
  return {
    ok: true,
    conversation: foundConversation,
    scope: foundScope,
    stored: storedMessages,
    memories: memoryItems,
  };
}
