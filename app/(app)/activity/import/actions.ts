"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { validateLedgerChange } from "@/lib/engine";
import { getSessionUser } from "@/lib/db/auth";
import { createAdminClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/database.types";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { ensureInstruments } from "@/lib/market-jobs/instruments";
import { backfillPendingInBackground } from "@/lib/portfolio/background";
import {
  getPortfolioContext,
  resolveChosenPortfolio,
} from "@/lib/portfolio/current-portfolio";
import { prepareImport } from "@/lib/portfolio/import-flow";
import type { ImportPreviewView } from "@/lib/portfolio/import-preview";
import { inputSignature } from "@/lib/portfolio/import-signature";
import { describeIssue } from "@/lib/portfolio/issues";
import { draftsToRpcRows, rowToTransaction } from "@/lib/portfolio/mappers";
import { portfolioOfAccount } from "@/lib/portfolio/portfolio-scope";
import {
  getImportAccountId,
  getInstruments,
  getTransactionIdsByImport,
  getTransactionRows,
} from "@/lib/portfolio/queries";
import { readImportInput } from "@/lib/validation/import";

export type ImportState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "preview"; view: ImportPreviewView; signature: string };

const GENERIC =
  "No pudimos procesar el archivo ahora. Probá de nuevo en un momento.";

/** ¿La persona tildó «Importar igual» para lo que parece repetir operaciones ya cargadas? */
const includeSuspectedOf = (formData: FormData) =>
  formData.get("include_suspected") === "1";

/**
 * Identifica lo elegido (archivo o texto pegado, y el «Importar igual») para que la vista previa no
 * sobreviva a un cambio. La calcula igual el navegador (`inputSignature`).
 */
const signatureOf = (formData: FormData) => {
  const include = includeSuspectedOf(formData);
  const portfolio = formData.get("portfolio");
  const target = typeof portfolio === "string" ? portfolio : "";
  const text = formData.get("text");
  if (typeof text === "string") {
    return inputSignature({ kind: "text", text }, include, target);
  }
  const file = formData.get("file");
  return file instanceof File
    ? inputSignature(
        { kind: "file", name: file.name, size: file.size },
        include,
        target,
      )
    : "";
};

const NO_PORTFOLIO = "Elegí un portafolio de la lista.";

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
    const file = await readImportInput(formData);
    if (!file.ok) return { status: "error", message: file.message };

    const portfolio = await resolveChosenPortfolio(
      supabase,
      formData.get("portfolio"),
    );
    if (!portfolio) return { status: "error", message: NO_PORTFOLIO };
    const prepared = await prepareImport(
      supabase,
      portfolio.account,
      file.text,
      new Date(),
      { includeSuspected: includeSuspectedOf(formData) },
    );
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
    const file = await readImportInput(formData);
    if (!file.ok) return { status: "error", message: file.message };

    const portfolio = await resolveChosenPortfolio(
      supabase,
      formData.get("portfolio"),
    );
    if (!portfolio) return { status: "error", message: NO_PORTFOLIO };
    const prepared = await prepareImport(
      supabase,
      portfolio.account,
      file.text,
      new Date(),
      { includeSuspected: includeSuspectedOf(formData) },
    );
    const { view } = prepared.preview;
    if (!view.canConfirm || prepared.source === null) {
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
      format: prepared.format,
      fileRows: view.fileRows,
      newCount: view.newCount,
      duplicateCount: view.duplicateCount,
      skipped: view.skipped.map(({ reason, count, rows }) => ({
        reason,
        count,
        rows,
      })),
      newSymbols: view.newSymbols,
      suspectedCount: view.suspectedCount,
      suspectedIncluded: view.suspectedIncluded,
    };
    const { data, error } = await supabase.rpc("import_transactions", {
      p_account_id: prepared.account.id,
      p_source: prepared.source,
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

export type UndoState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; deleted: number };

const importIdSchema = z.uuid();

/**
 * Deshace una importación: borra las operaciones que quedaron ligadas a ella. Antes comprueba que el
 * libro siga siendo consistente sin ellas (por ejemplo, que no quede una venta sin su compra) con
 * `validateLedgerChange`, y después llama a `undo_import`, que borra en una transacción y marca la
 * importación como deshecha.
 */
export async function undoImport(
  _previous: UndoState,
  formData: FormData,
): Promise<UndoState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const importId = importIdSchema.safeParse(formData.get("importId"));
  if (!importId.success) {
    return { status: "error", message: "La importación no es válida." };
  }

  let deleted = 0;
  try {
    const ids = await getTransactionIdsByImport(supabase, importId.data);
    if (ids.length === 0) {
      return {
        status: "error",
        message: "Esta importación ya no tiene operaciones para deshacer.",
      };
    }
    // El libro que se valida es el del portafolio de la importación, no el que se está mirando.
    const [accountId, { portfolios }] = await Promise.all([
      getImportAccountId(supabase, importId.data),
      getPortfolioContext(supabase),
    ]);
    const account = portfolioOfAccount(portfolios, accountId)?.account;
    if (!account) {
      return {
        status: "error",
        message: "Esta importación ya no tiene operaciones para deshacer.",
      };
    }

    const rows = await getTransactionRows(supabase, account.id);
    const instruments = await getInstruments(supabase, [
      ...new Set(
        rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : [])),
      ),
    ]);
    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const check = validateLedgerChange(
      rows.map((r) => rowToTransaction(r, account.id, symbolById)),
      { kind: "removeMany", ids },
      { currency: account.currency },
    );
    const blocker = check.newErrors[0];
    if (blocker) {
      return {
        status: "error",
        message: `No se puede deshacer esta importación: ${describeIssue(blocker)}. Borrá primero esa operación en Actividad.`,
      };
    }

    const { data, error } = await supabase.rpc("undo_import", {
      p_import_id: importId.data,
    });
    if (error) {
      console.error("[import-undo]", error.code, error.message);
      return { status: "error", message: GENERIC };
    }
    deleted = data ?? 0;
  } catch (error) {
    console.error("[import-undo]", describeError(error));
    return { status: "error", message: GENERIC };
  }

  revalidatePath("/", "layout");
  return { status: "done", deleted };
}
