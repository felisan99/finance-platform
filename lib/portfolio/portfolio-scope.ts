import type { AccountRow } from "./rows";

// Qué portafolio se está mirando. Puro: la cookie la leen y la escriben el servidor y las acciones.

/**
 * Cookie con el id del portafolio elegido. No es una credencial: el servidor la cruza siempre con los
 * portafolios que RLS deja leer, así que un id ajeno o viejo simplemente no coincide.
 */
export const PORTFOLIO_COOKIE = "pt-portfolio";
/** 400 días: el máximo que aceptan los navegadores. */
export const PORTFOLIO_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/** Un portafolio con su cuenta (cada portafolio tiene una; la app no muestra cuentas). */
export interface PortfolioRef {
  id: string;
  name: string;
  benchmarkSymbol: string;
  account: AccountRow;
}

/** El portafolio elegido si sigue existiendo; si no, el primero (el más viejo). */
export function pickPortfolio(
  portfolios: readonly PortfolioRef[],
  selectedId: string | null | undefined,
): PortfolioRef | null {
  return (
    portfolios.find((portfolio) => portfolio.id === selectedId) ??
    portfolios[0] ??
    null
  );
}

/**
 * El portafolio de una cuenta (para operaciones e importaciones, que se editan en el portafolio al
 * que pertenecen y no en el que se está mirando).
 */
export function portfolioOfAccount(
  portfolios: readonly PortfolioRef[],
  accountId: string | null | undefined,
): PortfolioRef | null {
  return (
    portfolios.find((portfolio) => portfolio.account.id === accountId) ?? null
  );
}

/** `Cripto & más` → `cripto-mas`: para el nombre del archivo exportado (solo ASCII). */
export function fileSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug === "" ? "portafolio" : slug;
}
