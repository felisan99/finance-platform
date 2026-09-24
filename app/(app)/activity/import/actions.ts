"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/db/auth";
import { createAdminClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/database.types";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { ensureInstruments } from "@/lib/market-jobs/instruments";
import { backfillPendingInBackground } from "@/lib/portfolio/background";
import { prepareImport } from "@/lib/portfolio/import-flow";
import type { ImportPreviewView } from "@/lib/portfolio/import-preview";
import { draftsToRpcRows } from "@/lib/portfolio/mappers";
import { readImportFile } from "@/lib/validation/import";

export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "preview"; view: ImportPreviewView; signature: string };

const GENERIC =
  "No pudimos procesar el archivo ahora. Probá de nuevo en un momento.";

/** Identifica el archivo elegido (nombre y tamaño) para que la vista previa no sobreviva a un cambio de archivo. */
const signatureOf = (formData: FormData) => {
  const file = formData.get("file");
  return file instanceof File ? `${file.name}|${file.size}` : "";
};

/** Paso 1: lee el archivo, lo cruza con la cuenta y devuelve la vista previa. No escribe nada. */
export async function previewImport(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  try {
    if (!(await takeRateLimit(supabase, "import_csv"))) {
      return {
        status: "error",
        message:
          "Demasiadas importaciones seguidas. Esperá un rato y probá de nuevo.",
      };
    }
    const file = await readImportFile(formData.get("file"));
    if (!file.ok) return { status: "error", message: file.message };

    const prepared = await prepareImport(supabase, file.text, new Date());
    if (!prepared)
      return { status: "error", message: "No encontramos tu cuenta." };
    return {
      status: "preview",
      view: prepared.preview.view,
      signature: signatureOf(formData),
    };
  } catch (error) {
    console.error("[import-preview]", describeError(error));
    return { status: "error", message: GENERIC };
  }
}

/**
 * Paso 2: vuelve a leer y a validar el archivo desde cero (no confía en la vista previa), crea los
 * instrumentos que faltan con la clave secreta y guarda todo en UNA transacción de base de datos
 * (`import_transactions`). Después, los precios de lo nuevo se descargan en segundo plano.
 */
export async function confirmImport(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  let inserted = 0;
  try {
    if (!(await takeRateLimit(supabase, "import_csv"))) {
      return {
        status: "error",
        message:
          "Demasiadas importaciones seguidas. Esperá un rato y probá de nuevo.",
      };
    }
    const file = await readImportFile(formData.get("file"));
    if (!file.ok) return { status: "error", message: file.message };

    const prepared = await prepareImport(supabase, file.text, new Date());
    if (!prepared)
      return { status: "error", message: "No encontramos tu cuenta." };
    const { view } = prepared.preview;
    if (!view.canConfirm) {
      return {
        status: "error",
        message: view.problems[0] ?? "El archivo no se puede importar.",
      };
    }

    await ensureInstruments(
      createAdminClient(),
      prepared.preview.newInstruments,
    );

    const report = {
      fileRows: view.fileRows,
      newCount: view.newCount,
      duplicateCount: view.duplicateCount,
      skipped: view.skipped.map(({ reason, count, rows }) => ({
        reason,
        count,
        rows,
      })),
      newSymbols: view.newSymbols,
    };
    const { data, error } = await supabase.rpc("import_transactions", {
      p_account_id: prepared.account.id,
      p_source: "delta_csv",
      p_filename: file.filename,
      p_rows: draftsToRpcRows(prepared.preview.toInsert) as unknown as Json,
      p_report: report as unknown as Json,
    });
    if (error) {
      console.error("[import-confirm]", error.code, error.message);
      return { status: "error", message: GENERIC };
    }
    inserted = data?.[0]?.inserted ?? 0;
  } catch (error) {
    console.error("[import-confirm]", describeError(error));
    return { status: "error", message: GENERIC };
  }

  // Los precios de los instrumentos nuevos no bloquean la respuesta.
  backfillPendingInBackground("import-backfill");

  revalidatePath("/", "layout");
  redirect(`/positions?importadas=${inserted}`);
}
