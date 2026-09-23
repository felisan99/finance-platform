import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "./database.types";
import { getPublicEnv } from "./env";

const secretKeySchema = z
  .string({ error: "falta SUPABASE_SECRET_KEY" })
  .min(1, "falta SUPABASE_SECRET_KEY");

/**
 * Cliente con la clave secreta (rol `service_role`): SALTA RLS. Solo del lado del servidor
 * (`server-only` rompe el build si un Client Component lo importa) y solo para tareas que no
 * pertenecen a un usuario: crons de precios, alta de instrumentos, tests de integración.
 * Nunca para atender lecturas o escrituras de un usuario.
 */
export function createAdminClient() {
  const env = getPublicEnv();
  const secretKey = secretKeySchema.parse(process.env.SUPABASE_SECRET_KEY);

  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
