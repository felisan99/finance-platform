import { describe, expect, it } from "vitest";
import { hardenSessionCookie, isSecureRequest } from "../cookie-options";

describe("hardenSessionCookie", () => {
  it("siempre httpOnly (la sesión no se lee desde scripts) y conserva el resto de las opciones", () => {
    expect(
      hardenSessionCookie(
        { path: "/", sameSite: "lax", maxAge: 34_560_000, domain: "x.test" },
        true,
      ),
    ).toEqual({
      path: "/",
      sameSite: "lax",
      maxAge: 34_560_000,
      domain: "x.test",
      httpOnly: true,
      secure: true,
    });
  });

  it("aunque la librería pida lo contrario, se impone httpOnly", () => {
    expect(
      hardenSessionCookie({ httpOnly: false, secure: false }, true),
    ).toMatchObject({ httpOnly: true, secure: true });
  });

  it("sin HTTPS no se marca Secure (el navegador descartaría la cookie en localhost)", () => {
    expect(hardenSessionCookie({ path: "/" }, false)).toEqual({
      path: "/",
      httpOnly: true,
      secure: false,
    });
  });

  it("sin opciones de la librería igual devuelve las de seguridad", () => {
    expect(hardenSessionCookie(undefined, true)).toEqual({
      httpOnly: true,
      secure: true,
    });
  });

  it("borrar la cookie (maxAge 0) mantiene los mismos atributos de seguridad", () => {
    expect(hardenSessionCookie({ maxAge: 0, path: "/" }, true)).toMatchObject({
      maxAge: 0,
      httpOnly: true,
      secure: true,
    });
  });
});

describe("isSecureRequest", () => {
  it("HTTPS según x-forwarded-proto (Vercel)", () => {
    expect(isSecureRequest("https")).toBe(true);
    expect(isSecureRequest("HTTPS")).toBe(true);
    expect(isSecureRequest("https, http")).toBe(true); // cadena de proxies: manda el primero
    expect(isSecureRequest(" https ")).toBe(true);
  });

  it("HTTP según x-forwarded-proto", () => {
    expect(isSecureRequest("http")).toBe(false);
    expect(isSecureRequest("http, https")).toBe(false);
    // Aunque la URL diga https, manda el encabezado del proxy.
    expect(isSecureRequest("http", "https:")).toBe(false);
  });

  it("sin encabezado se mira el protocolo de la URL", () => {
    expect(isSecureRequest(null, "https:")).toBe(true);
    expect(isSecureRequest(undefined, "https:")).toBe(true);
    expect(isSecureRequest(null, "http:")).toBe(false);
    expect(isSecureRequest(null)).toBe(false);
  });

  it("valores raros no cuentan como HTTPS", () => {
    for (const bad of ["", "ftp", "httpss", "xhttps", "https://x"]) {
      expect(isSecureRequest(bad), bad).toBe(false);
    }
  });
});
