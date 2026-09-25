import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "./admin";

/**
 * Límite de intentos de verificar el código de ingreso, ANTES de tener sesión. Las funciones SQL
 * (`take_login_attempt`, `clear_login_attempts`) solo las puede ejecutar `service_role`: por eso
 * este es un uso más de `createAdminClient` que no pertenece a un usuario (todavía no hay usuario).
 * La política (5 por 15 minutos por email) vive en la base.
 */

/** Clave del límite: SHA-256 del email ya normalizado (`loginSchema`). El email no se guarda. */
export function loginAttemptKey(email: string): string {
  return createHash("sha256").update(email, "utf8").digest("hex");
}

/**
 * Cuenta una verificación y devuelve si sigue dentro del límite (`false` = "esperá un rato").
 * Si la base falla, lanza: es mejor negar el ingreso que dejar adivinar sin tope.
 */
export async function takeLoginAttempt(email: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("take_login_attempt", {
    p_key: loginAttemptKey(email),
  });
  if (error) throw new Error(`db take_login_attempt: ${error.message}`);
  return data === true;
}

/** Tras un ingreso exitoso: entrar no gasta intentos. */
export async function clearLoginAttempts(email: string): Promise<void> {
  const { error } = await createAdminClient().rpc("clear_login_attempts", {
    p_key: loginAttemptKey(email),
  });
  if (error) throw new Error(`db clear_login_attempts: ${error.message}`);
}
