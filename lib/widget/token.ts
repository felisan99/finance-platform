import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

// El código del widget (docs/decisions.md, "Widget de iPhone"): 32 bytes al azar en base64url con
// un prefijo que lo hace reconocible. Se muestra una sola vez; en la base se guarda su SHA-256.

const PREFIX = "ptw_";
const RANDOM_BYTES = 32;

/** El formato exacto: lo que no cumple no llega a la base. */
export const widgetTokenSchema = z
  .string()
  .regex(/^ptw_[A-Za-z0-9_-]{43}$/, "código inválido");

export function generateWidgetToken(): string {
  return PREFIX + randomBytes(RANDOM_BYTES).toString("base64url");
}

/** SHA-256 en hexadecimal: lo que guarda `widget_tokens.token_hash`. */
export function hashWidgetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * El código de la cabecera `Authorization: Bearer <código>`, o `null` si falta o no tiene el
 * formato. El esquema se acepta sin distinguir mayúsculas (RFC 9110).
 */
export function readBearerToken(header: string | null): string | null {
  if (header === null) return null;
  const match = /^bearer +(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const parsed = widgetTokenSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}
