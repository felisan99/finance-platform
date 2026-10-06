/**
 * Reglas de acceso por ruta, sin dependencias de Next ni de Supabase para poder probarlas.
 * Rutas públicas para el proxy: la pantalla de ingreso (el código se verifica con una Server Action
 * de esa misma pantalla: no hay ruta de retorno), los crons (`/api/cron/*`) y lo que necesita
 * la app instalable (PWA) antes de tener sesión: el manifiesto, el service worker y la pantalla sin
 * conexión (`/pwa/*`). Los crons no tienen sesión de usuario: cada handler exige
 * `Authorization: Bearer ${CRON_SECRET}` y falla cerrado (ver lib/cron/auth.ts). Nada de lo
 * público de la PWA tiene datos de nadie: el último estado conocido vive en el dispositivo.
 * `/api/widget` (exacto) es el resumen para el widget de iPhone: no tiene sesión, lo protege el
 * código personal que manda el widget (ver app/api/widget/route.ts).
 */
const PUBLIC_PREFIXES = ["/login", "/api/cron", "/pwa"] as const;

/** Archivos sueltos que también son públicos (coincidencia exacta). */
const PUBLIC_FILES = new Set([
  "/sw.js",
  "/manifest.webmanifest",
  "/api/widget",
]);

const startsWithSegment = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_FILES.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => startsWithSegment(pathname, prefix))
  );
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
