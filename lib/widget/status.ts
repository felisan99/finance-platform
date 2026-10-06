import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/db/database.types";

// El código del widget de la persona, sin el hash (RLS y permisos por columna: `token_hash` no se
// puede leer). Para la pantalla de Más → Widget para iPhone.

export interface WidgetTokenInfo {
  /** `null` = todos los portafolios. */
  portfolioId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const rowSchema = z.object({
  portfolio_id: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
});

export async function getWidgetTokenInfo(
  client: SupabaseClient<Database>,
): Promise<WidgetTokenInfo | null> {
  const { data, error } = await client
    .from("widget_tokens")
    .select("portfolio_id, created_at, last_used_at")
    .maybeSingle();
  if (error) throw new Error(`db widget_tokens: ${error.message}`);
  if (data === null) return null;
  const row = rowSchema.safeParse(data);
  if (!row.success) throw new Error("db widget_tokens: formato inesperado");
  return {
    portfolioId: row.data.portfolio_id,
    createdAt: new Date(row.data.created_at),
    lastUsedAt:
      row.data.last_used_at === null ? null : new Date(row.data.last_used_at),
  };
}
