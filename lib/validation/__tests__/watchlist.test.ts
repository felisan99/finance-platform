import { describe, expect, it } from "vitest";
import { parseWatchlistSymbol } from "../watchlist";

describe("parseWatchlistSymbol", () => {
  it("normaliza: mayúsculas, sin espacios, punto o espacio de una clase pasa a guion", () => {
    expect(parseWatchlistSymbol("voo")).toEqual({ ok: true, symbol: "VOO" });
    expect(parseWatchlistSymbol("  aapl ")).toEqual({
      ok: true,
      symbol: "AAPL",
    });
    expect(parseWatchlistSymbol("brk.b")).toEqual({
      ok: true,
      symbol: "BRK-B",
    });
    expect(parseWatchlistSymbol("BRK B")).toEqual({
      ok: true,
      symbol: "BRK-B",
    });
  });

  it("rechaza lo que no es un símbolo", () => {
    for (const bad of [
      "",
      "   ",
      "A$B",
      "AA--B",
      "-AAPL",
      "AAPL-",
      "AA/BB",
      "<script>",
    ]) {
      expect(parseWatchlistSymbol(bad).ok, bad).toBe(false);
    }
  });

  it("rechaza lo demasiado largo sin explotar", () => {
    expect(parseWatchlistSymbol("A".repeat(16)).ok).toBe(false);
    expect(parseWatchlistSymbol("A".repeat(15)).ok).toBe(true);
    expect(parseWatchlistSymbol("A".repeat(10_000)).ok).toBe(false);
  });

  it("lo que no es texto (FormData vacío, archivo, undefined) es un error, no una excepción", () => {
    for (const bad of [null, undefined, 42, {}, [], new Blob(["x"])]) {
      expect(parseWatchlistSymbol(bad)).toEqual({
        ok: false,
        message: "Escribí un símbolo",
      });
    }
  });

  it("los mensajes están en español y dicen qué falló", () => {
    expect(parseWatchlistSymbol("").ok).toBe(false);
    const result = parseWatchlistSymbol("A$B");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Símbolo inválido/);
  });
});
