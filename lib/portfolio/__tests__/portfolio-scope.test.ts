import { describe, expect, it } from "vitest";
import {
  fileSlug,
  pickPortfolio,
  portfolioOfAccount,
  type PortfolioRef,
} from "../portfolio-scope";

const portfolio = (id: string, name = id): PortfolioRef => ({
  id,
  name,
  benchmarkSymbol: "SPY",
  account: {
    id: `acc-${id}`,
    name: "Cuenta principal",
    currency: "USD",
    cost_method: "AVERAGE",
  },
});

const list = [portfolio("a"), portfolio("b"), portfolio("c")];

describe("pickPortfolio", () => {
  it("el elegido, si sigue existiendo", () => {
    expect(pickPortfolio(list, "b")?.id).toBe("b");
  });

  it("sin elección, con uno ajeno o con uno borrado: el primero (el más viejo)", () => {
    expect(pickPortfolio(list, undefined)?.id).toBe("a");
    expect(pickPortfolio(list, null)?.id).toBe("a");
    expect(pickPortfolio(list, "")?.id).toBe("a");
    expect(pickPortfolio(list, "de-otra-persona")?.id).toBe("a");
  });

  it("sin portafolios, ninguno", () => {
    expect(pickPortfolio([], "a")).toBeNull();
  });
});

describe("portfolioOfAccount", () => {
  it("el portafolio de la cuenta, o ninguno si la cuenta no es de la persona", () => {
    expect(portfolioOfAccount(list, "acc-c")?.id).toBe("c");
    expect(portfolioOfAccount(list, "acc-x")).toBeNull();
    expect(portfolioOfAccount(list, null)).toBeNull();
    expect(portfolioOfAccount(list, undefined)).toBeNull();
  });
});

describe("fileSlug", () => {
  it("minúsculas, sin tildes y con guiones", () => {
    expect(fileSlug("Portafolio principal")).toBe("portafolio-principal");
    expect(fileSlug("Acciones & ETFs")).toBe("acciones-etfs");
    expect(fileSlug("Jubilación Ñandú")).toBe("jubilacion-nandu");
    expect(fileSlug("  --Cripto--  ")).toBe("cripto");
  });

  it("sin letras ni números queda un nombre genérico", () => {
    expect(fileSlug("🚀💰")).toBe("portafolio");
    expect(fileSlug("")).toBe("portafolio");
  });

  it("nunca pasa de 40 caracteres ni termina en guion", () => {
    const slug = fileSlug(`${"a".repeat(39)} b c d`);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("a".repeat(39));
  });

  it("solo ASCII seguro para Content-Disposition", () => {
    for (const name of ["Ação", 'Crédito "x"', "a/b\\c;d", "日本株"]) {
      expect(fileSlug(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
