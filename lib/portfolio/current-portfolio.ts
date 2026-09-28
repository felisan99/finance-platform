import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { isSecureRequest } from "@/lib/db/cookie-options";
import type { Database } from "@/lib/db/database.types";
import {
  PORTFOLIO_COOKIE,
  PORTFOLIO_COOKIE_MAX_AGE,
  pickScope,
  type PortfolioRef,
  type PortfolioScope,
} from "./portfolio-scope";
import { listPortfolios } from "./queries";

export interface PortfolioContext {
  /** Todos los portafolios de la persona, del más viejo al más nuevo. */
  portfolios: PortfolioRef[];
  /** Lo que se está mirando: un portafolio o «Todo junto»; `null` solo si no tiene ninguno. */
  scope: PortfolioScope | null;
  /**
   * El portafolio que se está mirando, si es uno solo: donde arrancan el alta de una operación y la
   * importación. `null` con «Todo junto» (ahí hay que elegir) o sin portafolios.
   */
  current: PortfolioRef | null;
}

/** Los portafolios de la persona y lo elegido en la cookie (si ya no existe, el primero). */
export async function getPortfolioContext(
  client: SupabaseClient<Database>,
): Promise<PortfolioContext> {
  const [portfolios, cookieStore] = await Promise.all([
    listPortfolios(client),
    cookies(),
  ]);
  const scope = pickScope(portfolios, cookieStore.get(PORTFOLIO_COOKIE)?.value);
  return {
    portfolios,
    scope,
    current: scope?.kind === "one" ? scope.portfolio : null,
  };
}

/**
 * El portafolio que eligió la persona en un formulario (alta de una operación, importación): tiene
 * que ser uno de los suyos. Sin elección, el que se está mirando (con «Todo junto» no hay: `null`).
 * `null` si no corresponde a ninguno.
 */
export async function resolveChosenPortfolio(
  client: SupabaseClient<Database>,
  chosen: FormDataEntryValue | null,
): Promise<PortfolioRef | null> {
  const { portfolios, current } = await getPortfolioContext(client);
  if (chosen === null || chosen === "") return current;
  return portfolios.find((portfolio) => portfolio.id === chosen) ?? null;
}

/**
 * Recuerda lo elegido: el id de un portafolio o `ALL_PORTFOLIOS` (solo desde una Server Action o un
 * Route Handler).
 */
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
