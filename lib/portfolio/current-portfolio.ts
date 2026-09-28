import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { isSecureRequest } from "@/lib/db/cookie-options";
import type { Database } from "@/lib/db/database.types";
import {
  PORTFOLIO_COOKIE,
  PORTFOLIO_COOKIE_MAX_AGE,
  pickPortfolio,
  type PortfolioRef,
} from "./portfolio-scope";
import { listPortfolios } from "./queries";

export interface PortfolioContext {
  /** Todos los portafolios de la persona, del más viejo al más nuevo. */
  portfolios: PortfolioRef[];
  /** El que se está mirando; `null` solo si la persona no tiene ninguno. */
  current: PortfolioRef | null;
}

/** Los portafolios de la persona y el elegido en la cookie (si ya no existe, el primero). */
export async function getPortfolioContext(
  client: SupabaseClient<Database>,
): Promise<PortfolioContext> {
  const [portfolios, cookieStore] = await Promise.all([
    listPortfolios(client),
    cookies(),
  ]);
  return {
    portfolios,
    current: pickPortfolio(
      portfolios,
      cookieStore.get(PORTFOLIO_COOKIE)?.value,
    ),
  };
}

/**
 * El portafolio que eligió la persona en un formulario (alta de una operación, importación): tiene
 * que ser uno de los suyos. Sin elección, el que se está mirando. `null` si no corresponde a ninguno.
 */
export async function resolveChosenPortfolio(
  client: SupabaseClient<Database>,
  chosen: FormDataEntryValue | null,
): Promise<PortfolioRef | null> {
  const { portfolios, current } = await getPortfolioContext(client);
  if (chosen === null || chosen === "") return current;
  return portfolios.find((portfolio) => portfolio.id === chosen) ?? null;
}

/** Recuerda el portafolio elegido (solo desde una Server Action o un Route Handler). */
export async function rememberPortfolio(id: string): Promise<void> {
  const secure = isSecureRequest((await headers()).get("x-forwarded-proto"));
  (await cookies()).set(PORTFOLIO_COOKIE, id, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: PORTFOLIO_COOKIE_MAX_AGE,
  });
}

/** Olvida el portafolio elegido (al cerrar sesión: la próxima persona arranca por el suyo). */
export async function forgetPortfolio(): Promise<void> {
  (await cookies()).delete(PORTFOLIO_COOKIE);
}
