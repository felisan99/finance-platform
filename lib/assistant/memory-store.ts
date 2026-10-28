import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/db/database.types";
import {
  MEMORY_KINDS,
  MemoryLimitError,
  type MemoryItem,
  type MemoryStore,
} from "./memory";

const COLUMNS = "id, kind, content, updated_at";
const rowSchema = z.object({
  id: z.string(),
  kind: z.enum(MEMORY_KINDS),
  content: z.string(),
  updated_at: z.string(),
});

const toItem = (row: z.infer<typeof rowSchema>): MemoryItem => ({
  id: row.id,
  kind: row.kind,
  content: row.content,
  updatedAt: row.updated_at,
});

/** La memoria de quien está en la sesión (RLS). El texto llega ya validado (`memoryTextSchema`). */
export function supabaseMemoryStore(
  client: SupabaseClient<Database>,
  userId: string,
): MemoryStore {
  return {
    async list() {
      const { data, error } = await client
        .from("assistant_memory")
        .select(COLUMNS)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw new Error(`db assistant_memory: ${error.message}`);
      return z.array(rowSchema).parse(data).map(toItem);
    },
    async add(kind, content) {
      const { data, error } = await client
        .from("assistant_memory")
        .insert({ user_id: userId, kind, content })
        .select(COLUMNS)
        .single();
      if (error?.code === "AM001") throw new MemoryLimitError(error.message);
      if (error) throw new Error(`db assistant_memory: ${error.message}`);
      return toItem(rowSchema.parse(data));
    },
    async update(id, content) {
      const { data, error } = await client
        .from("assistant_memory")
        .update({ content, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`db assistant_memory: ${error.message}`);
      return data ? toItem(rowSchema.parse(data)) : null;
    },
    async remove(id) {
      const { data, error } = await client
        .from("assistant_memory")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw new Error(`db assistant_memory: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}
