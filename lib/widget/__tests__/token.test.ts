import { describe, expect, it } from "vitest";
import {
  generateWidgetToken,
  hashWidgetToken,
  readBearerToken,
  widgetTokenSchema,
} from "../token";

describe("código del widget", () => {
  it("tiene el prefijo, 43 caracteres base64url y cumple su propio formato", () => {
    const token = generateWidgetToken();
    expect(token).toMatch(/^ptw_[A-Za-z0-9_-]{43}$/);
    expect(widgetTokenSchema.safeParse(token).success).toBe(true);
  });

  it("cada código es distinto", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateWidgetToken));
    expect(tokens.size).toBe(50);
  });

  it("el hash es el SHA-256 en hexadecimal (el formato que exige la base)", () => {
    expect(hashWidgetToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashWidgetToken(generateWidgetToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("readBearerToken", () => {
  const token = generateWidgetToken();

  it("lee el código de la cabecera, sin distinguir mayúsculas en el esquema", () => {
    expect(readBearerToken(`Bearer ${token}`)).toBe(token);
    expect(readBearerToken(`bearer ${token}`)).toBe(token);
    expect(readBearerToken(`  BEARER   ${token} `)).toBe(token);
  });

  it.each([
    null,
    "",
    "Bearer",
    "Bearer ",
    token,
    `Basic ${token}`,
    `Bearer ${token} extra`,
    `Bearer ${token}x`,
    `Bearer ${token.slice(0, -1)}`,
    `Bearer ptx_${token.slice(4)}`,
    `Bearer ${token.slice(0, -1)}=`,
  ])("rechaza %j", (header) => {
    expect(readBearerToken(header)).toBeNull();
  });
});
