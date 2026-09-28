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
  getPortfolioContext,
  resolveChosenPortfolio,
} from "@/lib/portfolio/current-portfolio";
import {
  portfolioOfAccount,
  type PortfolioRef,
} from "@/lib/portfolio/portfolio-scope";
import {
  getInstruments,
  getProviderSymbol,
  getTransactionRow,
  getTransactionRows,
} from "@/lib/portfolio/queries";
import type { TransactionRow } from "@/lib/portfolio/rows";
import {
  buildReferencePrice,
  type ReferencePrice,
} from "@/lib/portfolio/reference-price";
import {
  SYMBOL_PATTERN,
  normalizeSymbol,
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

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * El portafolio donde se guarda la operación. Una edición o un borrado van al portafolio al que
 * pertenece la operación (no se mueve de portafolio); un alta, al elegido en el formulario, que
 * tiene que ser uno de la persona (sin campo, el que se está mirando).
 */
async function targetPortfolio(
  supabase: Client,
  args: { editId: string | null; chosen: FormDataEntryValue | null },
): Promise<
  | { ok: true; portfolio: PortfolioRef; current: TransactionRow | null }
  | { ok: false; message: string; field?: "portfolio" }
> {
  if (args.editId !== null) {
    const [found, { portfolios }] = await Promise.all([
      getTransactionRow(supabase, args.editId),
      getPortfolioContext(supabase),
    ]);
    const portfolio = found
      ? portfolioOfAccount(portfolios, found.accountId)
      : null;
    if (!found || !portfolio)
      return { ok: false, message: "No encontramos esa operación." };
    return { ok: true, portfolio, current: found.row };
  }
  const portfolio = await resolveChosenPortfolio(supabase, args.chosen);
  return portfolio
    ? { ok: true, portfolio, current: null }
    : {
        ok: false,
        message: "Elegí en qué portafolio guardarla.",
        field: "portfolio",
      };
}

/** Las operaciones de una cuenta, como filas y como transacciones del motor. */
async function loadLedger(supabase: Client, accountId: string) {
  const rows = await getTransactionRows(supabase, accountId);
  const instruments = await getInstruments(supabase, [
    ...new Set(rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : []))),
  ]);
  const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
  return {
    rows,
    existing: rows.map((r) => rowToTransaction(r, accountId, symbolById)),
  };
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
    const target = await targetPortfolio(supabase, {
      editId,
      chosen: formData.get("portfolio"),
    });
    if (!target.ok)
      return target.field
        ? {
            status: "error",
            fieldErrors: { [target.field]: target.message },
            values,
          }
        : { status: "error", message: target.message, values };
    const { account } = target.portfolio;
    const { current } = target;
    const { existing } = await loadLedger(supabase, account.id);

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
    const target = await targetPortfolio(supabase, {
      editId: id,
      chosen: null,
    });
    if (!target.ok) return { status: "error", message: target.message };
    const { account } = target.portfolio;
    const { existing } = await loadLedger(supabase, account.id);

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

export type ReferencePriceResponse =
  | ({ ok: true; symbol: string } & ReferencePrice)
  | { ok: false; message: string };

/**
 * Precio de referencia para el alta de una operación: la cotización de hoy del símbolo elegido, que
 * el formulario deja escrita en el campo de precio. No guarda nada. Llama a Yahoo, así que exige
 * sesión y cuenta contra el mismo límite que la búsqueda de símbolos (30 por minuto): cada símbolo
 * elegido gasta una búsqueda de ese cupo. El símbolo se normaliza y se valida antes de consultar.
 */
export async function getReferencePrice(
  symbol: string,
): Promise<ReferencePriceResponse> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user)
    return { ok: false, message: "La sesión venció. Volvé a ingresar." };

  const normalized = typeof symbol === "string" ? normalizeSymbol(symbol) : "";
  if (
    normalized === "" ||
    normalized.length > 15 ||
    !SYMBOL_PATTERN.test(normalized)
  ) {
    return { ok: false, message: "Revisá el símbolo: no parece válido." };
  }
  const notFound = `No encontramos cotización de ${normalized}.`;

  try {
    if (!(await takeRateLimit(supabase, "search_symbols"))) {
      return {
        ok: false,
        message: "Muchas consultas seguidas. Esperá un momento.",
      };
    }
    const providerSymbol =
      (await getProviderSymbol(supabase, normalized)) ?? normalized;
    const [quote] = await (
      await getMarketDataProvider()
    ).getQuotes([providerSymbol]);
    if (!quote || quote.symbol.toUpperCase() !== providerSymbol.toUpperCase()) {
      return { ok: false, message: notFound };
    }
    const reference = buildReferencePrice(quote);
    return reference
      ? { ok: true, symbol: normalized, ...reference }
      : { ok: false, message: notFound };
  } catch (error) {
    if (error instanceof MarketDataError && error.kind === "NOT_FOUND") {
      return { ok: false, message: notFound };
    }
    if (!(error instanceof MarketDataError && error.kind === "BAD_REQUEST")) {
      console.error("[reference-price]", describeError(error));
    }
    return {
      ok: false,
      message: "No pudimos traer el precio actual ahora. Cargalo a mano.",
    };
  }
}
