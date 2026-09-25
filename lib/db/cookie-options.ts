import type { CookieOptions } from "@supabase/ssr";

/**
 * Opciones de las cookies de sesión. `@supabase/ssr` las deja legibles por JavaScript y sin
 * `Secure` porque asume un cliente de Supabase en el navegador; esta app no lo usa (todo pasa por
 * el servidor), así que la sesión no tiene por qué ser accesible desde scripts: `httpOnly` limita
 * el daño de un XSS. `secure` solo con HTTPS: sobre http://localhost (desarrollo, o un `next start`
 * local) el navegador descartaría la cookie.
 */
export function hardenSessionCookie(
  options: CookieOptions | undefined,
  secure: boolean,
): CookieOptions {
  return { ...options, httpOnly: true, secure };
}

/**
 * ¿La petición llegó por HTTPS? Detrás del proxy de Vercel el servidor ve HTTP y el protocolo
 * original viene en `x-forwarded-proto`.
 */
export function isSecureRequest(
  forwardedProto: string | null | undefined,
  urlProtocol?: string,
): boolean {
  const proto = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  return proto === "https" || (proto === undefined && urlProtocol === "https:");
}
