import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_BYTES,
  NOT_CSV_MESSAGE,
  PASTED_FILENAME,
  readImportFile,
  readImportInput,
  readImportText,
  sanitizeFilename,
} from "../import";

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
      message: NOT_CSV_MESSAGE,
    });
  });

  it("rechaza un binario renombrado a .csv (bytes nulos)", async () => {
    const binary = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x08,
    ]); // cabecera de un zip/xlsx
    expect(await readImportFile(file(binary, "planilla.csv"))).toEqual({
      ok: false,
      message: expect.stringContaining("No parece un archivo CSV de texto"),
    });
  });

  it("los mensajes de archivo que no es CSV explican qué hacer con una planilla", async () => {
    const wrongExtension = await readImportFile(file("a,b\n", "datos.xlsx"));
    expect(wrongExtension).toMatchObject({
      message: expect.stringContaining("Google Sheets"),
    });
    expect(NOT_CSV_MESSAGE).toContain("Pegar filas");
  });
});

describe("readImportText (filas pegadas)", () => {
  it("devuelve el texto tal cual y un nombre fijo", () => {
    const text = "fecha\ttipo\n2026-03-09\tcompra\n";
    expect(readImportText(text)).toEqual({
      ok: true,
      text,
      filename: PASTED_FILENAME,
    });
  });

  it.each([
    ["vacío", ""],
    ["solo espacios y saltos", "  \n\t \n"],
    ["no es un texto", 42],
    ["ausente", null],
    ["undefined", undefined],
  ])("rechaza %s", (_label, value) => {
    expect(readImportText(value)).toEqual({
      ok: false,
      message: "Pegá las filas primero",
    });
  });

  it("rechaza lo que pesa más de 1 MB (en bytes, no en caracteres)", () => {
    expect(readImportText("a".repeat(MAX_IMPORT_BYTES)).ok).toBe(true);
    expect(readImportText("a".repeat(MAX_IMPORT_BYTES + 1))).toEqual({
      ok: false,
      message: "Lo pegado pesa más de 1 MB",
    });
    // "ñ" pesa 2 bytes: la mitad de caracteres ya pasa del tope.
    expect(readImportText("ñ".repeat(MAX_IMPORT_BYTES / 2 + 1)).ok).toBe(false);
  });

  it("rechaza bytes nulos", () => {
    expect(readImportText("a\u0000b")).toMatchObject({ ok: false });
  });
});

describe("readImportInput", () => {
  it("lee el archivo cuando no hay texto", async () => {
    const form = new FormData();
    form.set("file", file("a,b\n1,2\n", "mis.csv"));
    expect(await readImportInput(form)).toMatchObject({
      ok: true,
      filename: "mis.csv",
    });
  });

  it("lee el texto pegado cuando viene el campo text", async () => {
    const form = new FormData();
    form.set("text", "a,b\n1,2\n");
    expect(await readImportInput(form)).toMatchObject({
      ok: true,
      filename: PASTED_FILENAME,
    });
  });

  it("si vienen los dos, gana el texto; un texto vacío no cae al archivo", async () => {
    const form = new FormData();
    form.set("file", file("a,b\n", "viejo.csv"));
    form.set("text", "");
    expect(await readImportInput(form)).toEqual({
      ok: false,
      message: "Pegá las filas primero",
    });
  });

  it("sin nada: pide elegir un archivo", async () => {
    expect(await readImportInput(new FormData())).toMatchObject({
      ok: false,
      message: expect.stringContaining("Elegí un archivo"),
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
