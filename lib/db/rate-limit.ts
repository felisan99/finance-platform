import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** Claves con política definida en la base (`take_rate_limit`): el límite no lo elige el cliente. */
export type RateLimitKey =
  | "refresh_quotes"
  | "search_symbols"
  | "import_csv"
  | "assistant_message"
  | "assistant_daily"
  | "news_search";

/**
 * Cuenta un uso de `key` para el usuario de la sesión y devuelve si sigue dentro del límite
 * (`false` = "esperá un rato"). Las políticas (`refresh_quotes` 1 cada 5 min, `search_symbols` 30
 * por minuto, `import_csv` 20 por hora, las del asistente y las noticias) viven en la función SQL. Si la base falla, lanza: es mejor
 * un error que dejar pasar sin límite.
 */
export async function takeRateLimit(
  client: SupabaseClient<Database>,
  key: RateLimitKey,
): Promise<boolean> {
  const { data, error } = await client.rpc("take_rate_limit", { p_key: key });
  if (error) throw new Error(`db take_rate_limit: ${error.message}`);
  return data === true;
}
