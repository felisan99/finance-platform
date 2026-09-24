import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * Usuario de la sesión, verificado con `getClaims()` (valida el JWT); nunca `getSession()`, que en
 * el servidor solo lee la cookie sin verificarla. El proxy NO es una barrera de autorización: cada
 * página, acción y ruta llama a esto de nuevo, y RLS protege los datos de todos modos.
 */
export async function getSessionUser(
  client: SupabaseClient<Database>,
): Promise<SessionUser | null> {
  const { data } = await client.auth.getClaims();
  const claims = data?.claims;
  if (!claims || typeof claims.sub !== "string" || claims.sub === "")
    return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}
