"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/db/auth";
import { takeRateLimit } from "@/lib/db/rate-limit";
import { createClient } from "@/lib/db/server";
import { validateLedgerChange, type LedgerChange } from "@/lib/engine";
import {
  MarketDataError,
  describeError,
  getMarketDataProvider,
  type InstrumentSearchResult,
} from "@/lib/market-data";
import { cleanText } from "@/lib/market-data/sanitize";
import { backfillPendingInBackground } from "@/lib/portfolio/background";
import { resolveInstrumentId } from "@/lib/portfolio/instruments";
import { describeRejectedChange } from "@/lib/portfolio/issues";
import {
  inputToInsertRow,
  inputToTransaction,
  inputToValueColumns,
  rowToTransaction,
} from "@/lib/portfolio/mappers";
import {
  getInstruments,
  getPrimaryAccount,
  getTransactionRows,
} from "@/lib/portfolio/queries";
import {
  parseTransactionForm,
  type RawTransactionForm,
} from "@/lib/validation/transaction";

export type FormState =
  | { status: "idle" }
  | {
      status: "error";
      /** Mensaje general (no de un campo). */
      message?: string;
      fieldErrors?: Partial<Record<string, string>>;
      /** Lo que escribió la persona, para no perderlo al volver a mostrar el formulario. */
      values?: Record<string, string>;
    };

const GENERIC = "No pudimos guardar los cambios. Probá de nuevo en un momento.";

const uuid = z.uuid();

/** Los valores de texto del formulario, para devolverlos junto con un error. */
function echo(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && key !== "id") values[key] = value;
  }
  return values;
}

/** Alta o edición de una operación (spec §10.3). Con `id` en el formulario, edita; sin él, crea. */
export async function saveTransaction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const values = echo(formData);
  const idField = formData.get("id");
  const editId = typeof idField === "string" && idField !== "" ? idField : null;
  if (editId !== null && !uuid.safeParse(editId).success) {
    return { status: "error", message: "La operación no es válida.", values };
  }

  const parsed = parseTransactionForm(
    Object.fromEntries(formData) as RawTransactionForm,
    new Date(),
  );
  if (!parsed.ok)
    return { status: "error", fieldErrors: parsed.errors, values };
  const input = parsed.data;

  try {
    const account = await getPrimaryAccount(supabase);
    if (!account)
      return { status: "error", message: "No encontramos tu cuenta.", values };

    const rows = await getTransactionRows(supabase, account.id);
    const instruments = await getInstruments(supabase, [
      ...new Set(
        rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : [])),
      ),
    ]);
    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const existing = rows.map((r) =>
      rowToTransaction(r, account.id, symbolById),
    );

    const current = editId ? rows.find((r) => r.id === editId) : undefined;
    if (editId && !current) {
      return {
        status: "error",
        message: "No encontramos esa operación.",
        values,
      };
    }

    // El libro tiene que seguir siendo consistente (p. ej. no vender más de lo que hay).
    const change: LedgerChange = current
      ? {
          kind: "replace",
          id: current.id,
          tx: inputToTransaction(input, {
            id: current.id,
            accountId: account.id,
            createdAt: new Date(current.created_at),
            currency: account.currency,
          }),
        }
      : {
          kind: "add",
          tx: inputToTransaction(input, {
            id: crypto.randomUUID(),
            accountId: account.id,
            createdAt: new Date(),
            currency: account.currency,
          }),
        };
    const check = validateLedgerChange(existing, change, {
      currency: account.currency,
    });
    if (!check.ok) {
      return {
        status: "error",
        message: describeRejectedChange(check.newErrors),
        values,
      };
    }

    let instrumentId: string | null = null;
    if (input.symbol !== null) {
      const resolved = await resolveInstrumentId(supabase, input.symbol);
      if (!resolved.ok) {
        return {
          status: "error",
          fieldErrors: { symbol: resolved.message },
          values,
        };
      }
      instrumentId = resolved.id;
    }

    const { error } = current
      ? await supabase
          .from("transactions")
          .update(inputToValueColumns(input, instrumentId))
          .eq("id", current.id)
      : await supabase.from("transactions").insert(
          inputToInsertRow(input, {
            userId: user.id,
            accountId: account.id,
            instrumentId,
          }),
        );
    if (error) {
      console.error("[save-transaction]", error.code, error.message);
      return { status: "error", message: GENERIC, values };
    }
  } catch (error) {
    console.error("[save-transaction]", describeError(error));
    return { status: "error", message: GENERIC, values };
  }

  // Un símbolo recién dado de alta no tiene precios: se descargan sin hacer esperar a la persona.
  if (input.symbol !== null) backfillPendingInBackground("save-backfill");

  revalidatePath("/", "layout");
  redirect("/activity");
}

/** Borra una operación si el libro sigue siendo consistente sin ella. */
export async function deleteTransaction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const id = formData.get("id");
  if (typeof id !== "string" || !uuid.safeParse(id).success) {
    return { status: "error", message: "La operación no es válida." };
  }

  try {
    const account = await getPrimaryAccount(supabase);
    if (!account)
      return { status: "error", message: "No encontramos tu cuenta." };
    const rows = await getTransactionRows(supabase, account.id);
    if (!rows.some((r) => r.id === id)) {
      return { status: "error", message: "No encontramos esa operación." };
    }
    const instruments = await getInstruments(supabase, [
      ...new Set(
        rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : [])),
      ),
    ]);
    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const existing = rows.map((r) =>
      rowToTransaction(r, account.id, symbolById),
    );

    const check = validateLedgerChange(
      existing,
      { kind: "remove", id },
      { currency: account.currency },
    );
    if (!check.ok)
      return {
        status: "error",
        message: describeRejectedChange(check.newErrors),
      };

    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      console.error("[delete-transaction]", error.code, error.message);
      return { status: "error", message: GENERIC };
    }
  } catch (error) {
    console.error("[delete-transaction]", describeError(error));
    return { status: "error", message: GENERIC };
  }

  revalidatePath("/", "layout");
  redirect("/activity");
}

export type SearchResponse =
  | { ok: true; results: InstrumentSearchResult[] }
  | { ok: false; message: string };

/**
 * Autocompletado de símbolos (spec §10.3). Llama a Yahoo, así que exige sesión y tiene un límite
 * de uso por usuario (30 por minuto); la consulta se valida y se limpia.
 */
export async function searchInstruments(
  query: string,
): Promise<SearchResponse> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user)
    return { ok: false, message: "La sesión venció. Volvé a ingresar." };

  const text = typeof query === "string" ? cleanText(query, 41) : null;
  if (!text || text.length > 40) return { ok: true, results: [] };

  try {
    if (!(await takeRateLimit(supabase, "search_symbols"))) {
      return {
        ok: false,
        message: "Muchas búsquedas seguidas. Esperá un momento.",
      };
    }
    const results = await (await getMarketDataProvider()).search(text);
    return { ok: true, results };
  } catch (error) {
    if (!(error instanceof MarketDataError && error.kind === "BAD_REQUEST")) {
      console.error("[search-instruments]", describeError(error));
    }
    return {
      ok: false,
      message: "No pudimos buscar ahora. Podés escribir el símbolo a mano.",
    };
  }
}
