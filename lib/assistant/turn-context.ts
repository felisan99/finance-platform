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
 * - Mientras tanto corren solo dos lecturas baratas y acotadas (`select` bajo RLS, sin efectos):
 *   la conversación (una fila por id) y los portafolios (hasta 5). Los mensajes (hasta 200) y la
 *   memoria esperan a que pasen los límites: un pedido rechazado no los lee.
 * - Los rechazos se evalúan en el orden de siempre: límites, conversación (`no_conversation`),
 *   portafolio (`no_portfolio`). Un error de lectura lanza, como antes, salvo que un rechazo
 *   anterior ya decida la respuesta.
 */
export async function loadTurnContext<Scope>(
  deps: TurnContextDeps<Scope>,
): Promise<TurnContext<Scope>> {
  const conversation = background(deps.getConversation());
  const scope = background(deps.getScope());

  if (
    !(await deps.takeLimit("assistant_message")) ||
    !(await deps.takeLimit("assistant_daily"))
  ) {
    return { ok: false, reason: "rate_limited" };
  }

  const [foundConversation, foundScope] = await Promise.all([
    conversation,
    scope,
  ]);
  if (!foundConversation) return { ok: false, reason: "no_conversation" };
  if (!foundScope) return { ok: false, reason: "no_portfolio" };

  const [stored, memories] = await Promise.all([
    deps.loadMessages(foundConversation),
    deps.listMemories(),
  ]);
  return {
    ok: true,
    conversation: foundConversation,
    scope: foundScope,
    stored,
    memories,
  };
}
