import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  toUIMessageStream,
  type StreamTextEndEvent,
  type ToolSet,
  type UIMessage,
} from "ai";
import { after } from "next/server";
import { z } from "zod";
import { runAssistant } from "@/lib/assistant/agent";
import { ASSISTANT_GENERIC_ERROR } from "@/lib/assistant/chat-status";
import {
  estimateTokens,
  planCompaction,
  summarize,
} from "@/lib/assistant/compaction";
import { getAssistantConfig } from "@/lib/assistant/config";
import {
  appendMessages,
  getConversation,
  loadMessages,
  saveRun,
  saveSummary,
} from "@/lib/assistant/conversation-store";
import { supabaseMemoryStore } from "@/lib/assistant/memory-store";
import { createAssistantModel } from "@/lib/assistant/provider";
import { prepareTurn } from "@/lib/assistant/session";
import {
  errorCodeOf,
  summarizeRun,
  type RunMetrics,
} from "@/lib/assistant/telemetry";
import { loadTurnContext } from "@/lib/assistant/turn-context";
import {
  historyWithQuestion,
  messagesToPersist,
} from "@/lib/assistant/turn-messages";
import { getSessionUser } from "@/lib/db/auth";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";

// Varios pasos de modelo y tools: el máximo de Vercel Hobby (docs/limits.md).
export const maxDuration = 300;

const MAX_QUESTION = 2000;

const bodySchema = z.object({
  conversationId: z.uuid(),
  message: z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    text: z.string().trim().min(1).max(MAX_QUESTION),
  }),
});

// El cliente reconoce este texto como una falla informada por la ruta (`canRetry`).
const GENERIC = ASSISTANT_GENERIC_ERROR;

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Un turno del asistente, con streaming. La sesión se verifica acá (el proxy no es una barrera),
 * el cuerpo con Zod y el uso con dos límites en la base. El historial no lo manda el cliente: se
 * lee de la base (RLS) y solo llega la pregunta nueva. Guardar los mensajes, compactar y registrar
 * las métricas pasa después de la respuesta (`after`), sin demorarla.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) return json({ error: "La sesión venció. Volvé a ingresar." }, 401);

  const config = getAssistantConfig();
  if (!config) return json({ error: "El asistente no está disponible." }, 503);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: GENERIC }, 400);
  const { conversationId, message } = parsed.data;

  const started = performance.now();
  try {
    // Los límites deciden primero; conversación y portafolios (lecturas chicas) corren mientras tanto.
    const loaded = await loadTurnContext({
      takeLimit: (key) => takeRateLimit(supabase, key),
      getConversation: () => getConversation(supabase, conversationId),
      getScope: async () => (await getPortfolioContext(supabase)).scope,
      loadMessages: (found) => loadMessages(supabase, found),
      listMemories: () => supabaseMemoryStore(supabase, user.id).list(),
    });
    if (!loaded.ok) {
      if (loaded.reason === "rate_limited") {
        return json(
          { error: "Hiciste muchas preguntas seguidas. Esperá un rato." },
          429,
        );
      }
      if (loaded.reason === "no_conversation") {
        return json({ error: GENERIC }, 404);
      }
      return json({ error: "Todavía no tenés un portafolio." }, 409);
    }
    const { conversation, stored } = loaded;

    const now = new Date();
    const turn = prepareTurn({
      client: supabase,
      userId: user.id,
      scope: loaded.scope,
      config,
      summary: conversation.summary,
      memories: loaded.memories,
      now,
    });

    const question: UIMessage = {
      id: message.id,
      role: "user",
      parts: [{ type: "text", text: message.text }],
    };
    const validated = await safeValidateUIMessages({
      // Un reintento reenvía la pregunta que ya quedó guardada: no se repite.
      messages: historyWithQuestion(
        stored.map((m) => m.message),
        question,
      ),
    });
    if (!validated.success) {
      console.error(
        "[assistant] historial inválido",
        describeError(validated.error),
      );
    }
    const history = validated.success ? validated.data : [question];

    const model = createAssistantModel(config);
    let endEvent: StreamTextEndEvent<ToolSet> | null = null;
    let streamError: unknown = null;
    let resolveDone: (messages: UIMessage[] | null) => void = () => {};
    const done = new Promise<UIMessage[] | null>((resolve) => {
      resolveDone = resolve;
    });

    const result = runAssistant({
      model,
      instructions: turn.instructions,
      messages: await convertToModelMessages(history, { tools: turn.tools }),
      tools: turn.tools,
      onEnd: (event) => {
        endEvent = event;
      },
      onError: (error) => {
        streamError = error;
      },
    });
    // Que el turno termine y se guarde aunque la persona cierre la pestaña.
    void result.consumeStream();

    const stream = toUIMessageStream({
      stream: result.stream,
      originalMessages: history,
      // El razonamiento interno del modelo no se muestra ni se guarda.
      sendReasoning: false,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: ({ messages }) => resolveDone(messages),
      onError: (error) => {
        streamError ??= error;
        console.error("[assistant] stream", describeError(error));
        resolveDone(null);
        return GENERIC;
      },
    });

    after(async () => {
      const finalMessages = await Promise.race([
        done,
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), (maxDuration - 10) * 1000),
        ),
      ]);
      const fresh = messagesToPersist(finalMessages, history, question);
      const run: RunMetrics = summarizeRun({
        event: endEvent,
        requestedModel: config.model,
        timings: turn.timings,
        latencyMs: performance.now() - started,
        errorCode: streamError ? errorCodeOf(streamError) : null,
      });
      try {
        await appendMessages(supabase, user.id, conversation.id, fresh);
        await compactIfNeeded(conversation.id, run);
      } catch (error) {
        console.error("[assistant] guardar", describeError(error));
      }
      try {
        await saveRun(supabase, user.id, conversation.id, run);
      } catch (error) {
        console.error("[assistant] métricas", describeError(error));
      }
    });

    async function compactIfNeeded(id: string, run: RunMetrics) {
      const current = await getConversation(supabase, id);
      if (!current) return;
      const messages = await loadMessages(supabase, current);
      const plan = planCompaction(messages, current.summary);
      if (!plan.compact) return;
      const summary = await summarize(
        model,
        current.summary,
        plan.fold.map((m) => m.message),
      );
      if (!summary) return;
      await saveSummary(supabase, id, summary, plan.through);
      const kept = messages.filter((m) => m.seq > plan.through);
      run.compacted = true;
      run.contextTokensBefore =
        estimateTokens(current.summary) +
        estimateTokens(messages.map((m) => m.message));
      run.contextTokensAfter =
        estimateTokens(summary) + estimateTokens(kept.map((m) => m.message));
    }

    return createUIMessageStreamResponse({
      stream,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[assistant]", describeError(error));
    return json({ error: GENERIC }, 500);
  }
}
