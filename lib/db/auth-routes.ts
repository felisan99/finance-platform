/**
 * Reglas de acceso por ruta, sin dependencias de Next ni de Supabase para poder probarlas.
 * Rutas públicas: la pantalla de ingreso y el retorno del enlace de acceso (`/auth/*`).
 * (Los crons de la Fase 3, `/api/cron/*`, se agregarán acá: se autentican con CRON_SECRET.)
 */
const PUBLIC_PREFIXES = ["/login", "/auth"] as const;

const startsWithSegment = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => startsWithSegment(pathname, prefix));
}

/**
 * A dónde redirigir una petición, o `null` si sigue su curso.
 * Sin sesión, todo lo que no sea público va a /login; con sesión, /login lleva al inicio.
 */
export function resolveAuthRedirect(
  pathname: string,
  isAuthenticated: boolean,
): "/login" | "/" | null {
  if (!isAuthenticated && !isPublicPath(pathname)) return "/login";
  if (isAuthenticated && startsWithSegment(pathname, "/login")) return "/";
  return null;
}
