"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { validateLedgerChange } from "@/lib/engine";
import { describeError } from "@/lib/market-data";
import { loadPendingDividends } from "@/lib/portfolio/dividends-data";
import { WITHHOLDING_OPTIONS } from "@/lib/portfolio/dividends-view";
import { describeRejectedChange } from "@/lib/portfolio/issues";
import {
  dividendToInsertRows,
  dividendToTransactions,
} from "@/lib/portfolio/mappers";
import { listPortfolios, loadScopeSnapshot } from "@/lib/portfolio/queries";

export type DividendActionState =
  | { status: "idle" }
  | { status: "ok"; message: string; at: number }
  | { status: "error"; message: string };

const GENERIC = "No pudimos guardar los cambios. Probá de nuevo en un momento.";

const keySchema = z
  .string()
  .regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/, "Propuesta inválida");
const keysSchema = z.array(keySchema).min(1).max(200);

/**
 * Agrega los dividendos elegidos (el `DIVIDEND` bruto y la retención como `TAX`). Los montos no
 * vienen del cliente: se vuelven a calcular acá con el libro y la tasa de la persona, y solo se
 * guarda lo que sigue pendiente. El libro de cada cuenta se valida antes de escribir.
 */
export async function confirmDividends(
  _previous: DividendActionState,
  formData: FormData,
): Promise<DividendActionState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const keys = keysSchema.safeParse(formData.getAll("key"));
  if (!keys.success) return { status: "error", message: GENERIC };

  let added = 0;
  try {
    // Todas las cuentas de la persona (RLS); se miran solo las que aparecen en lo pedido.
    const wanted = new Set(keys.data);
    const accounts = new Set(keys.data.map((key) => key.split(":")[0]!));
    const portfolios = (await listPortfolios(supabase)).filter((p) =>
      accounts.has(p.account.id),
    );
    if (portfolios.length === 0) return { status: "error", message: GENERIC };

    const snapshot = await loadScopeSnapshot(
      supabase,
      portfolios.length === 1
        ? { kind: "one", portfolio: portfolios[0]! }
        : { kind: "all", portfolios },
    );
    const now = new Date();
    const { items } = await loadPendingDividends(supabase, snapshot, now);
    const chosen = items.filter((item) => wanted.has(item.key));
    if (chosen.length === 0) {
      return {
        status: "error",
        message: "Esos dividendos ya no están pendientes.",
      };
    }

    for (const part of snapshot.parts) {
      const account = part.portfolio.account;
      const mine = chosen.filter(
        (item) => item.portfolio.account.id === account.id,
      );
      if (mine.length === 0) continue;

      const txs = mine.flatMap((item) =>
        dividendToTransactions(item.suggestion, {
          accountId: account.id,
          currency: account.currency,
          now,
        }),
      );
      const check = validateLedgerChange(
        part.transactions,
        { kind: "addMany", txs },
        { currency: account.currency },
      );
      if (!check.ok) {
        return {
          status: "error",
          message: describeRejectedChange(check.newErrors),
        };
      }

      const rows = mine.flatMap((item) => {
        const instrument = snapshot.instrumentBySymbol.get(
          item.suggestion.symbol,
        );
        if (!instrument)
          throw new Error(`sin instrumento para ${item.suggestion.symbol}`);
        return dividendToInsertRows(item.suggestion, {
          userId: user.id,
          accountId: account.id,
          instrumentId: instrument.id,
          currency: account.currency,
        });
      });
      const { error } = await supabase.from("transactions").insert(rows);
      if (error?.code === "23505") {
        return {
          status: "error",
          message: "Alguno de esos dividendos ya estaba agregado.",
        };
      }
      if (error) throw new Error(`db transactions: ${error.message}`);
      added += mine.length;
    }
  } catch (error) {
    console.error("[confirm-dividends]", describeError(error));
    return { status: "error", message: GENERIC };
  }

  revalidatePath("/", "layout");
  return {
    status: "ok",
    message:
      added === 1
        ? "Se agregó 1 dividendo."
        : `Se agregaron ${added} dividendos.`,
    at: Date.now(),
  };
}

/** Descarta una propuesta: no se vuelve a mostrar (por ejemplo, si el broker no lo pagó). */
export async function dismissDividend(
  _previous: DividendActionState,
  formData: FormData,
): Promise<DividendActionState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const key = keySchema.safeParse(formData.get("key"));
  if (!key.success) return { status: "error", message: GENERIC };
  const [accountId, eventId] = key.data.split(":") as [string, string];

  const { error } = await supabase.from("dividend_dismissals").insert({
    user_id: user.id,
    account_id: accountId,
    corporate_action_id: eventId,
  });
  // Ya descartado: da lo mismo.
  if (error && error.code !== "23505") {
    console.error("[dismiss-dividend]", error.code, error.message);
    return { status: "error", message: GENERIC };
  }
  revalidatePath("/", "layout");
  return { status: "ok", message: "Descartado.", at: Date.now() };
}

const rateSchema = z.enum(
  WITHHOLDING_OPTIONS.map((option) => option.value) as [string, ...string[]],
);

/** La retención que aplica EE. UU. a los dividendos de la persona. */
export async function setWithholdingRate(
  _previous: DividendActionState,
  formData: FormData,
): Promise<DividendActionState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  const rate = rateSchema.safeParse(formData.get("rate"));
  if (!rate.success) return { status: "error", message: GENERIC };

  const { error } = await supabase
    .from("profiles")
    .update({ dividend_withholding_rate: Number(rate.data) })
    .eq("id", user.id);
  if (error) {
    console.error("[withholding-rate]", error.code, error.message);
    return { status: "error", message: GENERIC };
  }
  revalidatePath("/", "layout");
  return { status: "ok", message: "Retención actualizada.", at: Date.now() };
}
