import { describe, expect, it } from "vitest";
import {
  ALL_PORTFOLIOS,
  ALL_PORTFOLIOS_LABEL,
  benchmarkOfScope,
  fileSlug,
  pickPortfolio,
  pickScope,
  portfolioOfAccount,
  portfoliosOfScope,
  scopeName,
  scopeValue,
  type PortfolioRef,
} from "../portfolio-scope";

const portfolio = (
  id: string,
  name = id,
  benchmarkSymbol = "SPY",
): PortfolioRef => ({
  id,
  name,
  benchmarkSymbol,
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

describe("pickScope", () => {
  it("«Todo junto» solo si se eligió y hay más de un portafolio", () => {
    expect(pickScope(list, ALL_PORTFOLIOS)).toEqual({
      kind: "all",
      portfolios: list,
    });
    expect(pickScope([list[0]!], ALL_PORTFOLIOS)).toEqual({
      kind: "one",
      portfolio: list[0],
    });
  });

  it("si no, el portafolio elegido o el primero; sin portafolios, nada", () => {
    expect(pickScope(list, "c")).toEqual({ kind: "one", portfolio: list[2] });
    expect(pickScope(list, "de-otra-persona")).toEqual({
      kind: "one",
      portfolio: list[0],
    });
    expect(pickScope(list, undefined)).toEqual({
      kind: "one",
      portfolio: list[0],
    });
    expect(pickScope([], ALL_PORTFOLIOS)).toBeNull();
    expect(pickScope([], "a")).toBeNull();
  });

  it("la lista de «Todo junto» es una copia: cambiarla no toca la original", () => {
    const scope = pickScope(list, ALL_PORTFOLIOS);
    if (scope?.kind !== "all") throw new Error("esperaba «Todo junto»");
    expect(scope.portfolios).not.toBe(list);
  });
});

describe("lo que se mira: nombre, valor del selector, portafolios y benchmark", () => {
  const one = { kind: "one", portfolio: list[1]! } as const;
  const all = { kind: "all", portfolios: list } as const;

  it("nombre y valor", () => {
    expect(scopeName(one)).toBe("b");
    expect(scopeName(all)).toBe(ALL_PORTFOLIOS_LABEL);
    expect(scopeValue(one)).toBe("b");
    expect(scopeValue(all)).toBe(ALL_PORTFOLIOS);
  });

  it("portafolios del alcance", () => {
    expect(portfoliosOfScope(one)).toEqual([list[1]]);
    expect(portfoliosOfScope(all)).toEqual(list);
  });

  it("benchmark: el del portafolio; con todos, el que comparten o SPY", () => {
    const crypto = portfolio("x", "Cripto", "BTC-USD");
    expect(benchmarkOfScope({ kind: "one", portfolio: crypto })).toBe(
      "BTC-USD",
    );
    expect(benchmarkOfScope(all)).toBe("SPY");
    expect(
      benchmarkOfScope({
        kind: "all",
        portfolios: [crypto, portfolio("y", "Otra", "BTC-USD")],
      }),
    ).toBe("BTC-USD");
    expect(
      benchmarkOfScope({ kind: "all", portfolios: [list[0]!, crypto] }),
    ).toBe("SPY");
  });
});
