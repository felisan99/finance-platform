import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../markdown";

describe("parseInline", () => {
  it("negrita, código y links https", () => {
    expect(
      parseInline(
        "Vale **US$ 1.000** según `computeTwr`, ver [nota](https://example.com/a).",
      ),
    ).toEqual([
      { kind: "text", text: "Vale " },
      { kind: "strong", text: "US$ 1.000" },
      { kind: "text", text: " según " },
      { kind: "code", text: "computeTwr" },
      { kind: "text", text: ", ver " },
      { kind: "link", text: "nota", href: "https://example.com/a" },
      { kind: "text", text: "." },
    ]);
  });

  it("una URL suelta se enlaza sin la puntuación final", () => {
    expect(parseInline("Fuente: https://example.com/x.")).toEqual([
      { kind: "text", text: "Fuente: " },
      {
        kind: "link",
        text: "https://example.com/x",
        href: "https://example.com/x",
      },
      { kind: "text", text: "." },
    ]);
  });

  it("nunca enlaza http, javascript ni URLs con credenciales", () => {
    for (const text of [
      "[a](http://example.com)",
      "[a](javascript:alert(1))",
      "[a](https://user:pass@example.com)",
    ]) {
      expect(
        parseInline(text).some((i) => i.kind === "link"),
        text,
      ).toBe(false);
    }
  });

  it("el HTML queda como texto", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([
      { kind: "text", text: "<img src=x onerror=alert(1)>" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("párrafos, títulos y listas", () => {
    const blocks = parseMarkdown(
      "### Resumen\nLínea uno\nsigue acá\n\n- uno\n- **dos**\n1. a\n2. b\n\nFin",
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "paragraph",
    ]);
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      inlines: [{ kind: "text", text: "Línea uno sigue acá" }],
    });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
  });

  it("texto vacío: ningún bloque", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n")).toEqual([]);
  });
});
