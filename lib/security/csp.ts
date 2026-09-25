/**
 * Content-Security-Policy de la app. Es una política "intermedia": Next inyecta scripts y estilos en
 * línea (arranque de React, datos de las pantallas), así que `script-src` y `style-src` llevan
 * `'unsafe-inline'`. Aun así corta lo que más importa si algún día se cuela un XSS:
 *
 * - `default-src`/`script-src 'self'`: no se carga ningún script de otro origen.
 * - `connect-src 'self'`: el navegador solo habla con esta app (no hay cliente de Supabase en la
 *   página), así que nada puede sacar datos hacia otro dominio con fetch/XHR/WebSocket.
 * - `form-action`, `base-uri`, `object-src`, `frame-ancestors`: sin formularios hacia afuera, sin
 *   `<base>` inyectado, sin plugins y sin que otro sitio la embeba.
 *
 * La política estricta (nonces por petición, sin `'unsafe-inline'`) pide renderizar todo de forma
 * dinámica y queda para la Fase 7. No se agrega `upgrade-insecure-requests`: rompería `next start`
 * sobre http://localhost; HTTPS lo fuerza Strict-Transport-Security.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
