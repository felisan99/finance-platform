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
    "/api/cron",
    "/api/cron/daily-prices",
    "/api/cron/backfill",
    // La app instalable (PWA): tiene que cargar antes de tener sesión.
    "/sw.js",
    "/manifest.webmanifest",
    "/pwa",
    "/pwa/offline.html",
    "/pwa/offline.js",
    "/pwa/offline.css",
  ])("%s es pública", (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    "/",
    "/positions",
    "/positions/VOO",
    "/activity/import",
    "/settings",
    // El retorno del enlace mágico se eliminó con el ingreso por código: ya no es público.
    "/auth",
    "/auth/callback",
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
    // Los archivos públicos de la PWA son exactos: no abren nada más.
    "/sw.js/x",
    "/sw.jsx",
    "/sw.json",
    "/x/sw.js",
    "/manifest.webmanifest/x",
    "/manifest.json",
    "/offline.html",
    "/pwa-admin",
    "/pwax/offline.html",
    "/x/pwa",
  ])("%s no se confunde con un prefijo público", (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});

describe("resolveAuthRedirect", () => {
  describe("sin sesión", () => {
    it.each([
      "/",
      "/positions",
      "/positions/VOO",
      "/watchlist",
      "/activity/import",
      "/auth/callback",
      "/offline.html",
      "/sw.js/x",
    ])("%s redirige a /login", (pathname) => {
      expect(resolveAuthRedirect(pathname, false)).toBe("/login");
    });

    it.each([
      "/login",
      "/api/cron/daily-prices",
      "/sw.js",
      "/manifest.webmanifest",
      "/pwa/offline.html",
    ])("%s sigue su curso", (pathname) => {
      expect(resolveAuthRedirect(pathname, false)).toBeNull();
    });
  });

  describe("con sesión", () => {
    it.each(["/login", "/login/"])("%s lleva al inicio", (pathname) => {
      expect(resolveAuthRedirect(pathname, true)).toBe("/");
    });

    it.each([
      "/",
      "/positions",
      "/watchlist",
      "/api/cron/backfill",
      "/sw.js",
      "/pwa/offline.html",
    ])("%s sigue su curso", (pathname) => {
      expect(resolveAuthRedirect(pathname, true)).toBeNull();
    });
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
