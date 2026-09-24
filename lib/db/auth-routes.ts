/**
 * Reglas de acceso por ruta, sin dependencias de Next ni de Supabase para poder probarlas.
 * Rutas públicas para el proxy: la pantalla de ingreso, el retorno del enlace de acceso
 * (`/auth/*`) y los crons (`/api/cron/*`). Los crons no tienen sesión de usuario: cada handler
 * exige `Authorization: Bearer ${CRON_SECRET}` y falla cerrado (ver lib/cron/auth.ts).
 */
const PUBLIC_PREFIXES = ["/login", "/auth", "/api/cron"] as const;

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

/**
 * `true` si la ruta tiene una codificación de URL mal formada (`%zz`, `%E0%A4%A`). El enrutador
 * de Next responde 500 a las rutas dinámicas con parámetros así, sin pasar por ninguna pantalla:
 * el proxy las corta antes con un 400.
 */
export function hasMalformedEncoding(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}
