import { describe, expect, it } from "vitest";
import { inputSignature } from "../import-signature";

describe("inputSignature", () => {
  it("un archivo se identifica por nombre y tamaño", () => {
    const a = inputSignature({ kind: "file", name: "a.csv", size: 10 }, false);
    expect(a).toBe(
      inputSignature({ kind: "file", name: "a.csv", size: 10 }, false),
    );
    expect(a).not.toBe(
      inputSignature({ kind: "file", name: "b.csv", size: 10 }, false),
    );
    expect(a).not.toBe(
      inputSignature({ kind: "file", name: "a.csv", size: 11 }, false),
    );
  });

  it("un texto cambia de firma con cualquier carácter distinto, aunque tenga el mismo largo", () => {
    const base = inputSignature(
      { kind: "text", text: "fecha\ttipo\n2026-03-09\tcompra" },
      false,
    );
    expect(base).toBe(
      inputSignature(
        { kind: "text", text: "fecha\ttipo\n2026-03-09\tcompra" },
        false,
      ),
    );
    expect(base).not.toBe(
      inputSignature(
        { kind: "text", text: "fecha\ttipo\n2026-03-09\tventa " },
        false,
      ),
    );
    expect(base).not.toBe(
      inputSignature(
        { kind: "text", text: "fecha\ttipo\n2026-03-10\tcompra" },
        false,
      ),
    );
  });

  it("no depende del salto de línea: el multipart del navegador convierte \\n en \\r\\n", () => {
    const lf = "fecha\ttipo\n2026-03-09\tcompra\n";
    expect(inputSignature({ kind: "text", text: lf }, false)).toBe(
      inputSignature({ kind: "text", text: lf.replace(/\n/g, "\r\n") }, false),
    );
    expect(inputSignature({ kind: "text", text: "a\rb" }, false)).toBe(
      inputSignature({ kind: "text", text: "a\nb" }, false),
    );
  });

  it("incluir las parecidas cambia la firma; un archivo y un texto nunca coinciden", () => {
    const file = { kind: "file", name: "a.csv", size: 1 } as const;
    expect(inputSignature(file, false)).not.toBe(inputSignature(file, true));
    expect(inputSignature({ kind: "text", text: "x" }, false)).not.toBe(
      inputSignature({ kind: "file", name: "x", size: 1 }, false),
    );
  });

  it("otro portafolio de destino cambia la firma (la vista previa se armó contra el otro)", () => {
    const file = { kind: "file", name: "a.csv", size: 1 } as const;
    const text = { kind: "text", text: "x" } as const;
    expect(inputSignature(file, false, "p1")).not.toBe(
      inputSignature(file, false, "p2"),
    );
    expect(inputSignature(text, false, "p1")).not.toBe(
      inputSignature(text, false, "p2"),
    );
    expect(inputSignature(file, false, "p1")).toBe(
      inputSignature(file, false, "p1"),
    );
    expect(inputSignature({ kind: "none" }, false, "p1")).toBe("");
  });

  it("sin nada elegido, la firma es vacía", () => {
    expect(inputSignature({ kind: "none" }, true)).toBe("");
  });
});
