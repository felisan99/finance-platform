import { createHash, timingSafeEqual } from "node:crypto";

/** Un secreto más corto se considera mal configurado: `openssl rand -hex 32` da 64 caracteres. */
export const MIN_CRON_SECRET_LENGTH = 32;

export type CronAuthResult = "ok" | "unauthorized" | "misconfigured";

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/**
 * Autoriza una llamada de cron: `Authorization: Bearer ${CRON_SECRET}` (Vercel lo envía solo
 * cuando la variable existe). Falla cerrado: sin secreto configurado, o demasiado corto, nadie
 * pasa (`misconfigured`); no se compara el token contra un valor por defecto ni vacío.
 *
 * La comparación es en tiempo constante: se comparan los hashes SHA-256 (largo fijo), así que
 * `timingSafeEqual` no lanza por largos distintos ni se filtra el largo del secreto.
 */
export function verifyCronAuthorization(
  authorization: string | null | undefined,
  secret: string | undefined,
): CronAuthResult {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) return "misconfigured";
  if (!authorization) return "unauthorized";
  const match = /^Bearer[ \t]+(\S+)$/i.exec(authorization.trim());
  const token = match?.[1];
  if (!token) return "unauthorized";
  return timingSafeEqual(sha256(token), sha256(secret)) ? "ok" : "unauthorized";
}
