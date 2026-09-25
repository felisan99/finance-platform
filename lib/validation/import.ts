import { z } from "zod";
import { cleanText } from "@/lib/market-data/sanitize";

/** Un export de Delta de varios años pesa decenas de KB; 1 MB deja mucho margen (y es el tope de una Server Action). */
export const MAX_IMPORT_BYTES = 1_000_000;

/** Qué hacer con una planilla: lo más común que se sube en vez de un CSV. */
const SPREADSHEET_HINT =
  "Si lo tenés en Excel o Google Sheets, guardalo como CSV (Archivo → Guardar como / Descargar → CSV) o usá «Pegar filas».";
export const NOT_CSV_MESSAGE = `Subí un archivo .csv. ${SPREADSHEET_HINT}`;
export const BINARY_MESSAGE = `No parece un archivo CSV de texto. ${SPREADSHEET_HINT}`;

/** Nombre con el que se guarda una importación que se pegó en vez de subirse. */
export const PASTED_FILENAME = "Pegado desde planilla";

const fileSchema = z
  .instanceof(File, { message: "Elegí un archivo CSV" })
  .refine((file) => file.size > 0, "El archivo está vacío")
  .refine(
    (file) => file.size <= MAX_IMPORT_BYTES,
    "El archivo pesa más de 1 MB",
  )
  .refine((file) => /\.csv$/i.test(file.name), NOT_CSV_MESSAGE);

/** Nombre para guardar en `imports.filename`: sin carpetas, sin caracteres de control, acotado. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return cleanText(base, 120) ?? "importacion.csv";
}

export type ImportFileResult =
  { ok: true; text: string; filename: string } | { ok: false; message: string };

/**
 * Lee el archivo del FormData con las validaciones del servidor (tamaño, extensión, que sea
 * texto). El tipo MIME no se usa: los navegadores lo informan distinto según el sistema.
 */
export async function readImportFile(
  value: FormDataEntryValue | null | undefined,
): Promise<ImportFileResult> {
  const parsed = fileSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Archivo inválido",
    };
  }
  const text = await parsed.data.text();
  // Un binario renombrado a .csv (una planilla .xlsx, por ejemplo) trae bytes nulos.
  if (text.includes("\u0000")) {
    return { ok: false, message: BINARY_MESSAGE };
  }
  return { ok: true, text, filename: sanitizeFilename(parsed.data.name) };
}

/**
 * Lo pegado en el cuadro de texto (filas copiadas de una planilla), con los mismos topes que un
 * archivo: pesa a lo sumo 1 MB y no trae bytes nulos.
 */
export function readImportText(value: unknown): ImportFileResult {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, message: "Pegá las filas primero" };
  }
  if (new TextEncoder().encode(value).length > MAX_IMPORT_BYTES) {
    return { ok: false, message: "Lo pegado pesa más de 1 MB" };
  }
  if (value.includes("\u0000")) {
    return { ok: false, message: BINARY_MESSAGE };
  }
  return { ok: true, text: value, filename: PASTED_FILENAME };
}

/**
 * La entrada de una importación: el texto pegado (campo `text`) o el archivo (campo `file`). Si
 * llegan los dos, gana el texto: es lo último que la persona tocó en la pantalla.
 */
export async function readImportInput(
  formData: FormData,
): Promise<ImportFileResult> {
  const text = formData.get("text");
  if (typeof text === "string") return readImportText(text);
  return readImportFile(formData.get("file"));
}
