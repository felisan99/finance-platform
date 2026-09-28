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

/** Valor de la cookie para «Todo junto». */
export const ALL_PORTFOLIOS = "all";
/** Cómo se llama «Todo junto» en el selector y en los títulos. */
export const ALL_PORTFOLIOS_LABEL = "Todos los portafolios";
/** El benchmark de «Todo junto» cuando los portafolios no comparten uno. */
export const DEFAULT_BENCHMARK = "SPY";

/** Lo que se está mirando: un portafolio, o todos juntos (solo si hay más de uno). */
export type PortfolioScope =
  | { kind: "one"; portfolio: PortfolioRef }
  | { kind: "all"; portfolios: PortfolioRef[] };

/**
 * El alcance elegido en la cookie: «Todo junto» si se eligió y hay más de un portafolio; si no, el
 * portafolio elegido o, si ya no existe, el primero. `null` si la persona no tiene ninguno.
 */
export function pickScope(
  portfolios: readonly PortfolioRef[],
  selected: string | null | undefined,
): PortfolioScope | null {
  if (selected === ALL_PORTFOLIOS && portfolios.length > 1) {
    return { kind: "all", portfolios: [...portfolios] };
  }
  const portfolio = pickPortfolio(portfolios, selected);
  return portfolio ? { kind: "one", portfolio } : null;
}

export const portfoliosOfScope = (scope: PortfolioScope): PortfolioRef[] =>
  scope.kind === "one" ? [scope.portfolio] : scope.portfolios;

/** El nombre de lo que se mira: el del portafolio, o «Todos los portafolios». */
export const scopeName = (scope: PortfolioScope): string =>
  scope.kind === "one" ? scope.portfolio.name : ALL_PORTFOLIOS_LABEL;

/** Valor del selector (y de la cookie) para un alcance. */
export const scopeValue = (scope: PortfolioScope): string =>
  scope.kind === "one" ? scope.portfolio.id : ALL_PORTFOLIOS;

/**
 * El benchmark del alcance: el del portafolio o, con «Todo junto», el que comparten todos; si no
 * comparten uno (por ejemplo acciones contra SPY y cripto contra BTC-USD), SPY.
 */
export function benchmarkOfScope(scope: PortfolioScope): string {
  if (scope.kind === "one") return scope.portfolio.benchmarkSymbol;
  const symbols = new Set(scope.portfolios.map((p) => p.benchmarkSymbol));
  return symbols.size === 1 ? [...symbols][0]! : DEFAULT_BENCHMARK;
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
