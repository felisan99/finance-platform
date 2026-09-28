import { describe, expect, it } from "vitest";
import {
  PORTFOLIO_NAME_MAX,
  portfolioNameSchema,
  sameName,
} from "../portfolio";

const parse = (value: unknown) => portfolioNameSchema.safeParse(value);

describe("portfolioNameSchema", () => {
  it("limpia los espacios de los bordes y los repetidos", () => {
    expect(parse("  Cripto   largo ").data).toBe("Cripto largo");
  });

  it("rechaza vacío o solo espacios", () => {
    expect(parse("").success).toBe(false);
    expect(parse("   ").error?.issues[0]?.message).toBe("Escribí un nombre");
  });

  it(`acepta hasta ${PORTFOLIO_NAME_MAX} caracteres (contados después de limpiar)`, () => {
    expect(parse("a".repeat(PORTFOLIO_NAME_MAX)).success).toBe(true);
    expect(parse(` ${"a".repeat(PORTFOLIO_NAME_MAX)} `).success).toBe(true);
    expect(
      parse("a".repeat(PORTFOLIO_NAME_MAX + 1)).error?.issues[0]?.message,
    ).toBe(`Máximo ${PORTFOLIO_NAME_MAX} caracteres`);
  });

  it("rechaza saltos de línea, tabulaciones y caracteres invisibles", () => {
    for (const bad of ["a\nb", "a\tb", "a\u200bb", "a\u202eb", "a\u2028b"]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("acepta tildes, eñes y emojis", () => {
    expect(parse("Jubilación 🚀").data).toBe("Jubilación 🚀");
    expect(parse("Año Ñandú").success).toBe(true);
  });

  it("rechaza lo que no es texto", () => {
    expect(parse(undefined).success).toBe(false);
    expect(parse(42).success).toBe(false);
  });
});

describe("sameName", () => {
  it("no distingue mayúsculas (como el índice único de la base)", () => {
    expect(sameName("Cripto", "CRIPTO")).toBe(true);
    expect(sameName("Acción", "ACCIÓN")).toBe(true);
    expect(sameName("Cripto", "Cripto 2")).toBe(false);
  });
});
