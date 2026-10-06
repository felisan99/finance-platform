import { describe, expect, it } from "vitest";
import { readPortfolioParam } from "../params";

const at = (query: string) =>
  readPortfolioParam(`https://example.com/api/widget${query}`);

describe("readPortfolioParam", () => {
  it("sin parámetro o vacío: lo que eligió el código", () => {
    expect(at("")).toEqual({ ok: true, name: null });
    expect(at("?portfolio=")).toEqual({ ok: true, name: null });
    expect(at("?portfolio=%20%20")).toEqual({ ok: true, name: null });
  });

  it("el nombre, sin espacios en los bordes y con acentos y símbolos", () => {
    expect(at("?portfolio=%20Cripto%20")).toEqual({ ok: true, name: "Cripto" });
    expect(at(`?portfolio=${encodeURIComponent("Jubilación & más")}`)).toEqual({
      ok: true,
      name: "Jubilación & más",
    });
  });

  it("más largo que cualquier nombre de portafolio (40): no corresponde a ninguno", () => {
    expect(at(`?portfolio=${"a".repeat(40)}`)).toEqual({
      ok: true,
      name: "a".repeat(40),
    });
    expect(at(`?portfolio=${"a".repeat(41)}`)).toEqual({ ok: false });
  });
});
