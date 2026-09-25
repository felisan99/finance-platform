import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { hardenSessionCookie, isSecureRequest } from "./cookie-options";
import type { Database } from "./database.types";
import { getPublicEnv } from "./env";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers: actúa como el
 * usuario de la sesión (rol `authenticated`), así que RLS aplica. Lee y escribe la sesión en las
 * cookies de la petición.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const secure = isSecureRequest((await headers()).get("x-forwarded-proto"));
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(
                name,
                value,
                hardenSessionCookie(options, secure),
              );
            }
          } catch {
            // Un Server Component no puede escribir cookies. Es inocuo: el proxy ya refresca la
            // sesión en cada navegación y es quien fija las cookies y los headers de caché.
          }
        },
      },
    },
  );
}
