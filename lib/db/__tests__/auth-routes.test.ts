import { describe, expect, it } from "vitest";
import { isPublicPath, resolveAuthRedirect } from "../auth-routes";

describe("isPublicPath", () => {
  it.each(["/login", "/login/", "/auth", "/auth/callback"])(
    "%s es pública",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(true);
    },
  );

  it.each([
    "/",
    "/positions",
    "/positions/VOO",
    "/activity/import",
    "/settings",
  ])("%s es privada", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });

  it.each(["/login-secret", "/loginx", "/authors", "/auth-admin"])(
    "%s no se confunde con un prefijo público",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(false);
    },
  );
});

describe("resolveAuthRedirect", () => {
  describe("sin sesión", () => {
    it.each(["/", "/positions", "/positions/VOO", "/activity/import"])(
      "%s redirige a /login",
      (pathname) => {
        expect(resolveAuthRedirect(pathname, false)).toBe("/login");
      },
    );

    it.each(["/login", "/auth/callback"])("%s sigue su curso", (pathname) => {
      expect(resolveAuthRedirect(pathname, false)).toBeNull();
    });
  });

  describe("con sesión", () => {
    it.each(["/login", "/login/"])("%s lleva al inicio", (pathname) => {
      expect(resolveAuthRedirect(pathname, true)).toBe("/");
    });

    it.each(["/", "/positions", "/auth/callback"])(
      "%s sigue su curso",
      (pathname) => {
        expect(resolveAuthRedirect(pathname, true)).toBeNull();
      },
    );
  });
});
