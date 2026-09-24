import { describe, expect, it } from "vitest";
import { MIN_CRON_SECRET_LENGTH, verifyCronAuthorization } from "../auth";

const SECRET =
  "a3f1c9d24e7b58106fa2d3c4b5a69788a3f1c9d24e7b58106fa2d3c4b5a69788"; // 64 hex

describe("verifyCronAuthorization", () => {
  it("acepta el bearer correcto", () => {
    expect(verifyCronAuthorization(`Bearer ${SECRET}`, SECRET)).toBe("ok");
  });

  it("acepta el esquema en minúsculas y espacios alrededor (RFC 7235: no distingue mayúsculas)", () => {
    expect(verifyCronAuthorization(`bearer ${SECRET}`, SECRET)).toBe("ok");
    expect(verifyCronAuthorization(`BEARER   ${SECRET}  `, SECRET)).toBe("ok");
  });

  it.each([
    ["sin cabecera", null],
    ["cabecera vacía", ""],
    ["solo espacios", "   "],
    ["esquema Basic", `Basic ${SECRET}`],
    ["sin esquema", SECRET],
    ["Bearer sin token", "Bearer"],
    ["Bearer con token vacío", "Bearer   "],
    ["dos tokens", `Bearer ${SECRET} otro`],
    ["token incorrecto", `Bearer ${"0".repeat(64)}`],
    ["prefijo del secreto", `Bearer ${SECRET.slice(0, 63)}`],
    ["secreto con un carácter de más", `Bearer ${SECRET}x`],
    ["mismo largo, un carácter distinto", `Bearer ${SECRET.slice(0, 63)}0`],
    ["secreto en mayúsculas", `Bearer ${SECRET.toUpperCase()}`],
    ["token larguísimo", `Bearer ${"a".repeat(100_000)}`],
  ])("rechaza: %s", (_label, header) => {
    expect(verifyCronAuthorization(header, SECRET)).toBe("unauthorized");
  });

  it("undefined también es no autorizado", () => {
    expect(verifyCronAuthorization(undefined, SECRET)).toBe("unauthorized");
  });

  describe("falla cerrado si el secreto no está bien configurado", () => {
    it.each([
      ["ausente", undefined],
      ["vacío", ""],
      ["de un carácter", "x"],
      [
        `de ${MIN_CRON_SECRET_LENGTH - 1} caracteres`,
        "x".repeat(MIN_CRON_SECRET_LENGTH - 1),
      ],
    ])("secreto %s", (_label, secret) => {
      // Ni siquiera un token idéntico al secreto débil abre la puerta.
      expect(verifyCronAuthorization(`Bearer ${secret ?? ""}`, secret)).toBe(
        "misconfigured",
      );
      expect(verifyCronAuthorization(null, secret)).toBe("misconfigured");
      expect(verifyCronAuthorization("Bearer cualquiera", secret)).toBe(
        "misconfigured",
      );
    });

    it("el largo mínimo (32) ya sirve", () => {
      const secret = "b".repeat(MIN_CRON_SECRET_LENGTH);
      expect(verifyCronAuthorization(`Bearer ${secret}`, secret)).toBe("ok");
    });
  });
});
