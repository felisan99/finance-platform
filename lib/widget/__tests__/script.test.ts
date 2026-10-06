import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScriptableScript } from "../script";
import { WIDGET_VIEW_VERSION } from "../view";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  body: string,
) => unknown;

describe("buildScriptableScript", () => {
  it("es JavaScript válido (se compila, no se ejecuta)", () => {
    expect(
      () => new AsyncFunction(buildScriptableScript("https://example.com")),
    ).not.toThrow();
  });

  it("lleva el origen y consulta /api/widget con el código en la cabecera, no en la URL", () => {
    const script = buildScriptableScript("https://portfolio.example.com");
    expect(script).toContain('const ORIGIN = "https://portfolio.example.com";');
    expect(script).toContain('ORIGIN + "/api/widget"');
    expect(script).toContain('Authorization: "Bearer " + token');
  });

  it("el origen va escapado: no puede romper el script", () => {
    const origin = 'https://evil.example.com"; Keychain.remove("x"); //';
    const script = buildScriptableScript(origin);
    expect(script).toContain(`const ORIGIN = ${JSON.stringify(origin)};`);
    expect(() => new AsyncFunction(script)).not.toThrow();
  });

  it("la plantilla no lleva barras invertidas: se perderían (`\\.` llegaría al teléfono como `.`)", () => {
    const source = readFileSync(resolve(__dirname, "../script.ts"), "utf8");
    const template = source.slice(
      source.indexOf("return `"),
      source.lastIndexOf("`;"),
    );
    expect(template.length).toBeGreaterThan(1000);
    expect(template).not.toContain("\\");
  });

  it("no lleva ningún código personal", () => {
    expect(buildScriptableScript("https://example.com")).not.toMatch(
      /ptw_[A-Za-z0-9_-]{43}/,
    );
  });

  it("espera la misma versión de la respuesta que arma el servidor", () => {
    expect(buildScriptableScript("https://example.com")).toContain(
      `const VIEW_VERSION = ${WIDGET_VIEW_VERSION};`,
    );
  });
});
