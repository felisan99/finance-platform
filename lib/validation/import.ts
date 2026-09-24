import { z } from "zod";
import { cleanText } from "@/lib/market-data/sanitize";

/** Un export de Delta de varios años pesa decenas de KB; 1 MB deja mucho margen (y es el tope de una Server Action). */
export const MAX_IMPORT_BYTES = 1_000_000;

const fileSchema = z
  .instanceof(File, { message: "Elegí un archivo CSV" })
  .refine((file) => file.size > 0, "El archivo está vacío")
  .refine(
    (file) => file.size <= MAX_IMPORT_BYTES,
    "El archivo pesa más de 1 MB",
  )
  .refine(
    (file) => /\.csv$/i.test(file.name),
    "Subí un archivo con extensión .csv",
  );

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
    return { ok: false, message: "No parece un archivo CSV de texto" };
  }
  return { ok: true, text, filename: sanitizeFilename(parsed.data.name) };
}
