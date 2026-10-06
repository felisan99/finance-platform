import { isSecureRequest } from "@/lib/db/cookie-options";

// Origen de la app tal como lo ve la persona (detrás del proxy de Vercel el servidor ve HTTP):
// lo usa el script del widget para saber a dónde consultar.

/** Un host con puerto opcional: lo demás (rutas, credenciales, espacios) no es un host. */
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** `https://host` (o `http://` sin HTTPS, en desarrollo); `null` si el host no es válido. */
export function appOrigin(
  host: string | null,
  forwardedProto: string | null,
): string | null {
  if (!host || !HOST.test(host)) return null;
  const protocol = isSecureRequest(forwardedProto) ? "https" : "http";
  return new URL(`${protocol}://${host}`).origin;
}
