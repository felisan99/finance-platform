import { describe, expect, it } from "vitest";
import { loginAttemptKey } from "../login-attempts";

describe("loginAttemptKey", () => {
  it("es el SHA-256 en hexadecimal del email (vectores conocidos)", () => {
    expect(loginAttemptKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(loginAttemptKey("felipe@example.com")).toBe(
      "12d216f5096c445e7248035ac7d85e586c647ce185aca31774ab10088f7ae51f",
    );
  });

  it("codifica en UTF-8 (un email con acentos da el hash de siempre)", () => {
    expect(loginAttemptKey("ñandú@ejemplo.com")).toBe(
      "783ba6b4b56ba933715be113e9f9cff91d3f6540c0ef0258693881f1f3c5ebe8",
    );
  });

  it("cumple el CHECK de la base: 64 caracteres hexadecimales en minúscula", () => {
    for (const email of ["a@b.co", "x".repeat(300), "ñandú@ejemplo.com", ""]) {
      expect(loginAttemptKey(email)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("es determinista y distingue emails; normalizar es tarea de quien llama (loginSchema)", () => {
    expect(loginAttemptKey("a@b.co")).toBe(loginAttemptKey("a@b.co"));
    expect(loginAttemptKey("a@b.co")).not.toBe(loginAttemptKey("a@b.com"));
    expect(loginAttemptKey("a@b.co")).not.toBe(loginAttemptKey("A@b.co"));
  });

  it("no contiene el email", () => {
    expect(loginAttemptKey("felipe@example.com")).not.toContain("felipe");
  });
});
