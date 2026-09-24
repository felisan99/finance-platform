import { describe, expect, it } from "vitest";
import {
  hasMalformedEncoding,
  isPublicPath,
  resolveAuthRedirect,
} from "../auth-routes";

describe("isPublicPath", () => {
  it.each([
    "/login",
    "/login/",
    "/auth",
    "/auth/callback",
    "/api/cron",
    "/api/cron/daily-prices",
    "/api/cron/backfill",
  ])("%s es pública", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/positions",
    "/positions/VOO",
    "/activity/import",
    "/settings",
    "/api",
    "/api/other",
    "/api/export",
  ])("%s es privada", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });

  it.each([
    "/login-secret",
    "/loginx",
    "/authors",
    "/auth-admin",
    "/api/cronjob",
    "/api/cron-admin",
    "/x/api/cron",
  ])("%s no se confunde con un prefijo público", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});

describe("resolveAuthRedirect", () => {
  describe("sin sesión", () => {
    it.each(["/", "/positions", "/positions/VOO", "/activity/import"])(
      "%s redirige a /login",
      (pathname) => {
        expect(resolveAuthRedirect(pathname, false)).toBe("/login");
      },
    );

    it.each(["/login", "/auth/callback", "/api/cron/daily-prices"])(
      "%s sigue su curso",
      (pathname) => {
        expect(resolveAuthRedirect(pathname, false)).toBeNull();
      },
    );
  });

  describe("con sesión", () => {
    it.each(["/login", "/login/"])("%s lleva al inicio", (pathname) => {
      expect(resolveAuthRedirect(pathname, true)).toBe("/");
    });

    it.each(["/", "/positions", "/auth/callback", "/api/cron/backfill"])(
      "%s sigue su curso",
      (pathname) => {
        expect(resolveAuthRedirect(pathname, true)).toBeNull();
      },
    );
  });
});

describe("hasMalformedEncoding", () => {
  it.each([
    "/positions/%zz",
    "/positions/%E0%A4%A",
    "/activity/%",
    "/a/%E0%A4",
    "/%",
    "/x/%C0%80%",
  ])("%s está mal formada", (pathname) => {
    expect(hasMalformedEncoding(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/positions/VOO",
    "/positions/%41",
    "/positions/BRK%2DB",
    "/positions/%C3%B1",
    "/activity/00000000-0000-0000-0000-000000000000",
    "/login",
    "/x/100%25",
  ])("%s es válida", (pathname) => {
    expect(hasMalformedEncoding(pathname)).toBe(false);
  });
});
