import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "../login-errors";

describe("loginErrorMessage", () => {
  it("devuelve el mensaje del error conocido", () => {
    expect(loginErrorMessage("link")).toMatch(/El enlace no funcionó/);
  });

  it("devuelve undefined si no hay error o no se conoce", () => {
    expect(loginErrorMessage(undefined)).toBeUndefined();
    expect(loginErrorMessage("")).toBeUndefined();
    expect(loginErrorMessage("otro")).toBeUndefined();
    expect(loginErrorMessage("<script>alert(1)</script>")).toBeUndefined();
  });

  it.each([
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "valueOf",
  ])("no devuelve miembros del prototipo (%s)", (code) => {
    expect(loginErrorMessage(code)).toBeUndefined();
  });
});
