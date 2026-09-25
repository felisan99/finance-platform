import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthRedirect } from "./auth-routes";
import { hardenSessionCookie, isSecureRequest } from "./cookie-options";
import type { Database } from "./database.types";
import { getPublicEnv } from "./env";

/**
 * Se ejecuta en el proxy de Next (proxy.ts) en cada navegación: refresca la sesión de Supabase
 * (getClaims valida el JWT y renueva los tokens vencidos) y redirige según `resolveAuthRedirect`.
 *
 * Esto NO es la barrera de autorización: cada página o acción vuelve a verificar la sesión y
 * RLS es la protección real de los datos.
 */
export async function updateSession(request: NextRequest) {
  const env = getPublicEnv();
  const secure = isSecureRequest(
    request.headers.get("x-forwarded-proto"),
    request.nextUrl.protocol,
  );
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Tokens renovados: a los Server Components (request) y al navegador (response).
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(
              name,
              value,
              hardenSessionCookie(options, secure),
            );
          }
          // Cache-Control, Expires y Pragma: evitan que un CDN cachee una respuesta con sesión.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // No poner código entre createServerClient y getClaims: una sesión renovada podría perderse.
  const { data } = await supabase.auth.getClaims();

  const target = resolveAuthRedirect(
    request.nextUrl.pathname,
    Boolean(data?.claims),
  );
  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Conserva las cookies (y headers) de una sesión recién renovada.
    for (const cookie of response.cookies.getAll())
      redirect.cookies.set(cookie);
    response.headers.forEach((value, key) => {
      if (/^(cache-control|expires|pragma)$/i.test(key))
        redirect.headers.set(key, value);
    });
    return redirect;
  }

  return response;
}
