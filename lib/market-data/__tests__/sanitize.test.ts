import { describe, expect, it } from "vitest";
import { cleanText } from "../sanitize";

describe("cleanText", () => {
  it("recorta y colapsa espacios", () => {
    expect(cleanText("  Vanguard   S&P  500 ")).toBe("Vanguard S&P 500");
  });

  it("reemplaza controles, saltos de línea, ancho cero, BOM y separadores Unicode por espacios", () => {
    const messy = [
      "a",
      "\u0000",
      "b",
      "\n",
      "c",
      "​",
      "d",
      "﻿",
      "e",
      " ",
      "f",
      "\t",
      "g",
    ].join("");
    expect(cleanText(messy)).toBe("a b c d e f g");
  });

  it("acota el largo y marca el corte", () => {
    expect(cleanText("abcdefghij", 5)).toBe("abcd…");
    expect(cleanText("abcde", 5)).toBe("abcde");
  });

  it("devuelve null para vacío, solo controles o tipos que no son texto", () => {
    expect(cleanText("")).toBeNull();
    expect(cleanText("   \n\t ")).toBeNull();
    expect(cleanText("\u0000​")).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText(42)).toBeNull();
    expect(cleanText({})).toBeNull();
  });

  it("conserva acentos y símbolos habituales de un nombre", () => {
    expect(cleanText("Compañía Cervecerías Unidas S.A. (ADR) – Clase B")).toBe(
      "Compañía Cervecerías Unidas S.A. (ADR) – Clase B",
    );
  });
});
