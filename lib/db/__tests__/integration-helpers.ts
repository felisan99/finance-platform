import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import projects from "../../../supabase/projects.json";
import type { Database } from "../database.types";

// Infraestructura de los tests de integración (`pnpm test:integration`): pegan contra el proyecto
// Supabase de DESARROLLO (finance-dev) con usuarios de prueba que se crean y se borran.

export type DbClient = SupabaseClient<Database>;

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

interface Credentials {
  url: string;
  publishableKey: string;
  secretKey: string;
}

/**
 * Se niega a seguir si las variables de entorno no apuntan a finance-dev: los tests crean y
 * borran usuarios, así que jamás pueden correr contra producción (finance) ni contra otro proyecto.
 */
export function assertDevProject(): Credentials {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY o SUPABASE_SECRET_KEY en .env.local",
    );
  }

  const ref = new URL(url).hostname.split(".")[0];
  if (ref === projects.prod.ref) {
    throw new Error(
      `${url} es PRODUCCIÓN (${projects.prod.name}): los tests de integración no corren ahí`,
    );
  }
  if (ref !== projects.dev.ref) {
    throw new Error(
      `El proyecto ${ref} no es ${projects.dev.name} (${projects.dev.ref}): los tests de integración no corren ahí`,
    );
  }
  return { url, publishableKey, secretKey };
}

/** Cliente con la clave secreta (rol service_role): salta RLS. */
export function createAdmin(): DbClient {
  const { url, secretKey } = assertDevProject();
  return createClient<Database>(url, secretKey, clientOptions);
}

/** Cliente con la clave publicable y sin sesión (rol anon). */
export function createAnon(): DbClient {
  const { url, publishableKey } = assertDevProject();
  return createClient<Database>(url, publishableKey, clientOptions);
}

export interface TestUser {
  id: string;
  email: string;
  /** Actúa como este usuario (rol authenticated), con su sesión. */
  client: DbClient;
}

/**
 * Crea un usuario de prueba por la API de administración (no envía correos; el hook de registro
 * no alcanza a este camino) y abre su sesión con un código, como en la app (no hay contraseñas:
 * migración `no_passwords`). El trigger handle_new_user le crea perfil, portafolio, cuenta y
 * watchlist.
 */
export async function createTestUser(
  admin: DbClient,
  label: string,
): Promise<TestUser> {
  const { url, publishableKey } = assertDevProject();
  const email = `rls-${label}-${randomBytes(4).toString("hex")}@example.com`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  }

  const client = createClient<Database>(url, publishableKey, clientOptions);
  const signIn = await client.auth.verifyOtp({
    email,
    token: await generateLoginCode(admin, email),
    type: "email",
  });
  if (signIn.error) {
    throw new Error(`No se pudo iniciar sesión: ${signIn.error.message}`);
  }
  return { id: data.user.id, email, client };
}

/** Código de ingreso de 6 dígitos para un usuario que ya existe. `generateLink` nunca manda mail. */
export async function generateLoginCode(
  admin: DbClient,
  email: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data.properties) {
    throw new Error(`generateLink: ${error?.message}`);
  }
  return data.properties.email_otp;
}

export type TestUserRecord = Pick<TestUser, "id" | "email">;

/**
 * Usuario de prueba SIN sesión: una sola llamada a la API de administración. Para los tests que
 * operan con la clave secreta y solo necesitan un dueño para las filas (el trigger le crea
 * perfil, portafolio, cuenta y watchlist). No depende del camino de inicio de sesión (JWT).
 */
export async function createTestUserRecord(
  admin: DbClient,
  label: string,
): Promise<TestUserRecord> {
  const email = `rls-${label}-${randomBytes(4).toString("hex")}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  }
  return { id: data.user.id, email };
}

/** Borra el usuario; sus filas se van en cascada. */
export async function deleteTestUser(
  admin: DbClient,
  user: TestUserRecord | undefined,
): Promise<void> {
  if (!user) return;
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) console.warn(`No se pudo borrar ${user.email}: ${error.message}`);
}

/** Símbolo de instrumento de prueba, válido para el CHECK de public.instruments. */
export function randomSymbol(): string {
  return `ZT${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Códigos de error de Postgres que devuelve PostgREST. */
export const PG = {
  insufficientPrivilege: "42501", // permiso denegado o política de RLS violada
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
} as const;
