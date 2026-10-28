import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { z } from "zod";
import type { Database } from "@/lib/db/database.types";
import type { StoredMessage } from "./compaction";
import type { RunMetrics } from "./telemetry";

// Conversaciones, mensajes y métricas del asistente, con el cliente de la sesión (RLS).

type Client = SupabaseClient<Database>;

export interface Conversation {
  id: string;
  summary: string | null;
  summarizedThrough: number;
}

const conversationSchema = z.object({
  id: z.string(),
  summary: z.string().nullable(),
  summarized_through: z.number(),
});

const toConversation = (
  row: z.infer<typeof conversationSchema>,
): Conversation => ({
  id: row.id,
  summary: row.summary,
  summarizedThrough: row.summarized_through,
});

// La forma mínima de un mensaje guardado; el detalle de las partes lo valida `validateUIMessages`.
const uiMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.looseObject({ type: z.string() })),
});

/** Máximo de mensajes que se leen: con la compactación nunca deberían quedar tantos sin resumir. */
const MAX_MESSAGES = 200;

/** La conversación más reciente; si no hay ninguna, crea una. */
export async function getOrCreateActiveConversation(
  client: Client,
  userId: string,
): Promise<Conversation> {
  const { data, error } = await client
    .from("assistant_conversations")
    .select("id, summary, summarized_through")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`db assistant_conversations: ${error.message}`);
  if (data) return toConversation(conversationSchema.parse(data));
  return createConversation(client, userId);
}

export async function createConversation(
  client: Client,
  userId: string,
): Promise<Conversation> {
  const { data, error } = await client
    .from("assistant_conversations")
    .insert({ user_id: userId })
    .select("id, summary, summarized_through")
    .single();
  if (error) throw new Error(`db assistant_conversations: ${error.message}`);
  return toConversation(conversationSchema.parse(data));
}

/** `null` si no existe o no es de quien pregunta (RLS). */
export async function getConversation(
  client: Client,
  id: string,
): Promise<Conversation | null> {
  const { data, error } = await client
    .from("assistant_conversations")
    .select("id, summary, summarized_through")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`db assistant_conversations: ${error.message}`);
  return data ? toConversation(conversationSchema.parse(data)) : null;
}

/** Los mensajes todavía no resumidos, en orden. Uno que no valida se descarta (y se avisa). */
export async function loadMessages(
  client: Client,
  conversation: Conversation,
): Promise<StoredMessage[]> {
  const { data, error } = await client
    .from("assistant_messages")
    .select("seq, message")
    .eq("conversation_id", conversation.id)
    .gt("seq", conversation.summarizedThrough)
    .order("seq", { ascending: true })
    .limit(MAX_MESSAGES);
  if (error) throw new Error(`db assistant_messages: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const parsed = uiMessageSchema.safeParse(row.message);
    if (!parsed.success) {
      console.error("[assistant] mensaje guardado inválido", row.seq);
      return [];
    }
    return [{ seq: row.seq, message: parsed.data as UIMessage }];
  });
}

/** Todos los mensajes, para mostrar la conversación (incluye los ya resumidos). */
export async function loadAllMessages(
  client: Client,
  conversationId: string,
): Promise<UIMessage[]> {
  const { data, error } = await client
    .from("assistant_messages")
    .select("message")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: true })
    .limit(MAX_MESSAGES);
  if (error) throw new Error(`db assistant_messages: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const parsed = uiMessageSchema.safeParse(row.message);
    return parsed.success ? [parsed.data as UIMessage] : [];
  });
}

/**
 * Guarda mensajes al final de la conversación. Idempotente por `(conversation_id, ui_id)` (la
 * restricción única de la tabla): un mensaje cuyo id ya está guardado se ignora (`on conflict do
 * nothing`) y el resto se guarda igual. Así un reintento que reenvía la misma pregunta guarda su
 * respuesta sin duplicar la pregunta ni fallar. Solo pide `insert` (con `do nothing` no hay
 * `update`), que es lo que conceden los grants y la política de `assistant_messages`.
 */
export async function appendMessages(
  client: Client,
  userId: string,
  conversationId: string,
  messages: readonly UIMessage[],
): Promise<void> {
  const rows = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      ui_id: m.id,
      conversation_id: conversationId,
      user_id: userId,
      role: m.role,
      message: JSON.parse(JSON.stringify(m)),
    }));
  if (rows.length === 0) return;
  // Todas las filas con las mismas columnas (PostgREST completa las faltantes con NULL).
  const { error } = await client.from("assistant_messages").upsert(rows, {
    onConflict: "conversation_id,ui_id",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`db assistant_messages: ${error.message}`);
}

export async function saveSummary(
  client: Client,
  conversationId: string,
  summary: string,
  through: number,
): Promise<void> {
  const { error } = await client
    .from("assistant_conversations")
    .update({
      summary,
      summarized_through: through,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);
  if (error) throw new Error(`db assistant_conversations: ${error.message}`);
}

export async function saveRun(
  client: Client,
  userId: string,
  conversationId: string,
  run: RunMetrics,
): Promise<void> {
  const { error } = await client.from("assistant_runs").insert({
    user_id: userId,
    conversation_id: conversationId,
    model: run.model?.slice(0, 200) ?? null,
    fallback_used: run.fallbackUsed,
    steps: run.steps,
    tools: run.tools.map((t) => ({ name: t.name, ok: t.ok, ms: t.ms })),
    input_tokens: run.inputTokens,
    output_tokens: run.outputTokens,
    cost_usd: run.costUsd,
    ttft_ms: run.ttftMs,
    latency_ms: run.latencyMs,
    finish_reason: run.finishReason?.slice(0, 40) ?? null,
    error_code: run.errorCode?.slice(0, 80) ?? null,
    compacted: run.compacted,
    context_tokens_before: run.contextTokensBefore,
    context_tokens_after: run.contextTokensAfter,
  });
  if (error) throw new Error(`db assistant_runs: ${error.message}`);
}
