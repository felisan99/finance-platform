import { describe, expect, it } from "vitest";
import { MAX_IMPORT_BYTES, readImportFile, sanitizeFilename } from "../import";

const file = (content: string | Uint8Array, name = "delta.csv") =>
  new File([content as BlobPart], name);

describe("readImportFile", () => {
  it("lee un CSV válido y devuelve el texto y el nombre", async () => {
    const result = await readImportFile(
      file("Date,Way\n2026-03-09,BUY\n", "delta_export.csv"),
    );
    expect(result).toEqual({
      ok: true,
      text: "Date,Way\n2026-03-09,BUY\n",
      filename: "delta_export.csv",
    });
  });

  it("acepta la extensión en mayúsculas y conserva los acentos (File.text() ya descarta la BOM)", async () => {
    const result = await readImportFile(file("\uFEFFñandú", "EXPORT.CSV"));
    expect(result).toMatchObject({ ok: true, text: "ñandú" });
  });

  it.each([
    ["nada (campo ausente)", null, /Elegí un archivo/],
    ["undefined", undefined, /Elegí un archivo/],
    ["texto en vez de archivo", "hola.csv", /Elegí un archivo/],
  ])("rechaza %s", async (_label, value, expected) => {
    const result = await readImportFile(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(expected);
  });

  it("rechaza un archivo vacío", async () => {
    const result = await readImportFile(file("", "vacio.csv"));
    expect(result).toEqual({ ok: false, message: "El archivo está vacío" });
  });

  it("rechaza lo que pesa más de 1 MB, sin leerlo", async () => {
    const big = file(
      new Uint8Array(MAX_IMPORT_BYTES + 1).fill(65),
      "grande.csv",
    );
    expect(await readImportFile(big)).toEqual({
      ok: false,
      message: "El archivo pesa más de 1 MB",
    });
    const limit = file(new Uint8Array(MAX_IMPORT_BYTES).fill(65), "justo.csv");
    expect((await readImportFile(limit)).ok).toBe(true);
  });

  it.each([
    "datos.xlsx",
    "datos.csv.exe",
    "datos",
    "datos.txt",
    "csv",
    ".csv.zip",
  ])("rechaza la extensión de %s", async (name) => {
    const result = await readImportFile(file("a,b\n", name));
    expect(result).toEqual({
      ok: false,
      message: "Subí un archivo con extensión .csv",
    });
  });

  it("rechaza un binario renombrado a .csv (bytes nulos)", async () => {
    const binary = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x08,
    ]); // cabecera de un zip/xlsx
    expect(await readImportFile(file(binary, "planilla.csv"))).toEqual({
      ok: false,
      message: "No parece un archivo CSV de texto",
    });
  });
});

describe("sanitizeFilename", () => {
  it.each([
    ["delta_export.csv", "delta_export.csv"],
    ["C:\\Users\\yo\\Downloads\\delta.csv", "delta.csv"],
    ["/etc/passwd/../delta.csv", "delta.csv"],
    ["../../secreto.csv", "secreto.csv"],
    ["  con   espacios .csv ", "con espacios .csv"],
    ["saltos\nde\u0000línea.csv", "saltos de línea.csv"],
    ["", "importacion.csv"],
    ["///", "importacion.csv"],
  ])("%j → %j", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("acota el largo", () => {
    expect(
      sanitizeFilename(`${"a".repeat(300)}.csv`).length,
    ).toBeLessThanOrEqual(120);
  });
});
