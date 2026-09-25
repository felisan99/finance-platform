import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../csp";

/** `directiva → fuentes` de la política. */
const directives = new Map(
  CONTENT_SECURITY_POLICY.split(";").map((part) => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name!, sources] as const;
  }),
);

describe("CONTENT_SECURITY_POLICY", () => {
  it("cada directiva aparece una sola vez (el navegador ignora las repetidas)", () => {
    const names = CONTENT_SECURITY_POLICY.split(";").map(
      (part) => part.trim().split(/\s+/)[0],
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("no carga scripts, conexiones ni recursos de otros orígenes", () => {
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    // Sin cliente de Supabase en la página: nada de fetch/WebSocket hacia afuera.
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("worker-src")).toEqual(["'self'"]);
    expect(directives.get("manifest-src")).toEqual(["'self'"]);
  });

  it("cierra plugins, <base>, formularios ajenos y el embebido en otros sitios", () => {
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("no abre nada por comodín ni permite eval", () => {
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/\*/);
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:/);
  });

  it("las imágenes solo pueden ser propias, data: o blob:", () => {
    expect(directives.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
  });
});
