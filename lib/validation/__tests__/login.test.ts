import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  codeSchema,
  loginSchema,
  verifyCodeSchema,
} from "../login";

describe("loginSchema", () => {
  it("normaliza el email: sin espacios y en minúsculas", () => {
    const parsed = loginSchema.parse({ email: "  Felipe@Example.COM " });
    expect(parsed.email).toBe("felipe@example.com");
  });

  it("acepta emails con puntos y subdirecciones", () => {
    expect(
      loginSchema.safeParse({ email: "a.b+tag@sub.example.org" }).success,
    ).toBe(true);
  });

  it.each(["", "   ", "sin-arroba", "a@", "@b.com", "a b@c.com", "a@b"])(
    "rechaza %j",
    (email) => {
      expect(loginSchema.safeParse({ email }).success).toBe(false);
    },
  );

  it("rechaza un campo ausente o que no es texto (FormData.get puede dar null o un File)", () => {
    expect(loginSchema.safeParse({ email: null }).success).toBe(false);
    expect(loginSchema.safeParse({}).success).toBe(false);
    expect(loginSchema.safeParse({ email: 42 }).success).toBe(false);
  });
});

describe("codeSchema", () => {
  it("el largo coincide con el otp_length de supabase/config.toml", () => {
    expect(CODE_LENGTH).toBe(6);
  });

  it.each([
    ["123456", "123456"],
    ["000000", "000000"], // los ceros a la izquierda cuentan: es texto, no un número
    ["  123456  ", "123456"],
    ["123 456", "123456"], // así lo muestran algunos correos
    ["123\n456", "123456"],
    ["1 2 3 4 5 6", "123456"],
    ["123   456", "123456"], // varios espacios seguidos
    ["123\t456", "123456"],
  ])("acepta %j", (input, expected) => {
    expect(codeSchema.parse(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "12345", // corto
    "1234567", // largo
    "12345a",
    "abcdef",
    "12-3456",
    "123456.0",
    "+12345",
    "١٢٣٤٥٦", // dígitos arábigos: no son ASCII
    "１２３４５６", // dígitos de ancho completo
    "123456\u0000",
    "1".repeat(1000),
    `123${" ".repeat(40)}456`, // seis dígitos entre relleno: demasiado largo para ser un código pegado
  ])("rechaza %j", (input) => {
    expect(codeSchema.safeParse(input).success).toBe(false);
  });

  it("rechaza lo que no es texto (FormData.get puede dar null o un File)", () => {
    for (const input of [null, undefined, 123456, {}, [], new Blob(["1"])]) {
      expect(codeSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("verifyCodeSchema", () => {
  it("normaliza el email y limpia el código", () => {
    expect(
      verifyCodeSchema.parse({
        email: " Felipe@Example.COM ",
        token: "123 456",
      }),
    ).toEqual({ email: "felipe@example.com", token: "123456" });
  });

  it("falla si falta o es inválido cualquiera de los dos", () => {
    expect(verifyCodeSchema.safeParse({ email: "a@b.co" }).success).toBe(false);
    expect(verifyCodeSchema.safeParse({ token: "123456" }).success).toBe(false);
    expect(
      verifyCodeSchema.safeParse({ email: "sin-arroba", token: "123456" })
        .success,
    ).toBe(false);
    expect(
      verifyCodeSchema.safeParse({ email: "a@b.co", token: "12345" }).success,
    ).toBe(false);
  });
});
