import { headers } from "next/headers";

/**
 * Origen público del sitio, para armar la URL a la que vuelve el enlace de acceso.
 * Supabase valida esa URL contra la lista de redirecciones permitidas, así que un origen
 * falsificado no puede llevar el enlace a otro sitio.
 */
export async function getSiteOrigin(): Promise<string> {
  const requestHeaders = await headers();

  const origin = requestHeaders.get("origin");
  if (origin) return origin;

  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host) {
    const proto =
      requestHeaders.get("x-forwarded-proto") ??
      (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
