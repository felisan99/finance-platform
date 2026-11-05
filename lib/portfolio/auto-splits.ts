import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSessionUser } from "@/lib/db/auth";
import type { Database } from "@/lib/db/database.types";
import { chunk, fetchAllPages } from "@/lib/db/paginate";
import { describeError } from "@/lib/market-data";
import {
  d,
  marketDay,
  missingSplits,
  validateLedgerChange,
  type SplitEvent,
} from "@/lib/engine";
import {
  rowToTransaction,
  splitToInsertRow,
  splitToTransaction,
} from "./mappers";
import { portfoliosOfScope, type PortfolioScope } from "./portfolio-scope";
import {
  getInstruments,
  getTransactionRows,
  snapshotFromRows,
} from "./queries";
import { parseRows, type TransactionRow } from "./rows";
import type { PortfolioSnapshot } from "./snapshot";

// Splits automáticos (docs/decisions.md, «Splits automáticos»). Cuando el cron detecta un split
// (`corporate_actions`), se agrega el `SPLIT` al libro de cada cuenta que tenía el activo el día
// anterior. Se hace con la sesión de la persona (RLS), al abrir una pantalla con su cartera: la
// clave secreta no escribe en el libro de nadie. El cálculo es del motor (`missingSplits`).

type Client = SupabaseClient<Database>;
const loose = (client: Client) => client as unknown as SupabaseClient;

const IN_CHUNK = 100;

const splitEventRowSchema = z.object({
  id: z.string(),
  instrument_id: z.string(),
  ex_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ratio: z.string(),
});

const dismissalRowSchema = z.object({
  account_id: z.string(),
  corporate_action_id: z.string(),
});

/** El id de `corporate_actions` de un split automático, a partir de su `external_id`. */
export function splitEventIdOf(row: {
  source: string;
  external_id: string | null;
}): string | null {
  if (row.source !== "auto_split" || !row.external_id) return null;
  const match = /^split:([0-9a-f-]{36})$/.exec(row.external_id);
  return match ? match[1]! : null;
}

/**
 * Agrega los splits que le faltan a cada cuenta del alcance y devuelve las transacciones de cada
 * una, ya con los agregados. Nunca lanza: si algo falla, el libro queda como estaba (se reintenta
 * en la próxima carga) y la pantalla se muestra igual.
 */
export async function applyAutoSplits(
  client: Client,
  scope: PortfolioScope,
  rowsByPortfolio: ReadonlyArray<readonly TransactionRow[]>,
  now: Date,
): Promise<TransactionRow[][]> {
  const portfolios = portfoliosOfScope(scope);
  const result = rowsByPortfolio.map((rows) => [...rows]);
  try {
    const all = rowsByPortfolio.flat();
    const ids = [
      ...new Set(
        all.flatMap((r) => (r.instrument_id ? [r.instrument_id] : [])),
      ),
    ];
    if (ids.length === 0) return result;
    const first = all.reduce(
      (min, r) => (r.executed_at < min ? r.executed_at : min),
      all[0]!.executed_at,
    );
    const today = marketDay(now);

    // Lo común es que no haya ningún split: una sola consulta chica y nada más.
    const eventRows = parseRows(
      splitEventRowSchema,
      (
        await Promise.all(
          chunk(ids, IN_CHUNK).map((group) =>
            fetchAllPages((from, to) =>
              loose(client)
                .from("corporate_actions")
                .select("id, instrument_id, ex_date, ratio::text")
                .eq("type", "SPLIT")
                .in("instrument_id", group)
                .gte("ex_date", marketDay(new Date(first)))
                .lte("ex_date", today)
                .order("ex_date")
                .order("id")
                .range(from, to),
            ),
          ),
        )
      ).flat(),
      "corporate_actions",
    );
    if (eventRows.length === 0) return result;

    const user = await getSessionUser(client);
    if (!user) return result;
    const accountIds = portfolios.map((p) => p.account.id);
    const [instruments, dismissalRows] = await Promise.all([
      getInstruments(client, ids),
      fetchAllPages((from, to) =>
        loose(client)
          .from("split_dismissals")
          .select("account_id, corporate_action_id")
          .in("account_id", accountIds)
          .order("account_id")
          .order("corporate_action_id")
          .range(from, to),
      ).then((rows) => parseRows(dismissalRowSchema, rows, "split_dismissals")),
    ]);
    const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
    const idBySymbol = new Map(instruments.map((i) => [i.symbol, i.id]));
    const events: SplitEvent[] = eventRows.flatMap((row) => {
      const symbol = symbolById.get(row.instrument_id);
      return symbol
        ? [{ id: row.id, symbol, exDate: row.ex_date, ratio: d(row.ratio) }]
        : [];
    });

    for (const [i, portfolio] of portfolios.entries()) {
      const account = portfolio.account;
      const rows = result[i] ?? [];
      const existing = rows.map((r) =>
        rowToTransaction(r, account.id, symbolById),
      );
      const dismissed = new Set(
        dismissalRows
          .filter((row) => row.account_id === account.id)
          .map((row) => row.corporate_action_id),
      );
      const missing = missingSplits({
        transactions: existing,
        events,
        dismissed,
        today,
        options: { currency: account.currency },
      });
      if (missing.length === 0) continue;

      const check = validateLedgerChange(
        existing,
        {
          kind: "addMany",
          txs: missing.map((split) =>
            splitToTransaction(split, {
              accountId: account.id,
              currency: account.currency,
              now,
            }),
          ),
        },
        { currency: account.currency },
      );
      if (!check.ok) {
        console.error(
          "[auto-splits] el libro no admite los splits",
          missing.map((s) => `${s.symbol} ${s.exDate}`).join(", "),
        );
        continue;
      }

      const insert = missing.flatMap((split) => {
        const instrumentId = idBySymbol.get(split.symbol);
        return instrumentId
          ? [
              splitToInsertRow(split, {
                userId: user.id,
                accountId: account.id,
                instrumentId,
                currency: account.currency,
              }),
            ]
          : [];
      });
      // Dos pantallas abiertas a la vez pueden intentarlo juntas: `transactions_dedup` deja uno.
      const { error } = await client.from("transactions").upsert(insert, {
        onConflict: "account_id,source,external_id",
        ignoreDuplicates: true,
      });
      if (error) {
        console.error("[auto-splits]", error.code, error.message);
        continue;
      }
      result[i] = await getTransactionRows(client, account.id);
    }
  } catch (error) {
    console.error("[auto-splits]", describeError(error));
  }
  return result;
}

/**
 * Lo mismo que `loadScopeSnapshot`, pero antes agrega los splits que falten. La usan las pantallas
 * que muestran la cartera; el asistente y el widget leen sin escribir.
 */
export async function loadScopeSnapshotWithSplits(
  client: Client,
  scope: PortfolioScope,
  now: Date,
): Promise<PortfolioSnapshot> {
  const rowsByPortfolio = await Promise.all(
    portfoliosOfScope(scope).map((portfolio) =>
      getTransactionRows(client, portfolio.account.id),
    ),
  );
  return snapshotFromRows(
    client,
    scope,
    await applyAutoSplits(client, scope, rowsByPortfolio, now),
  );
}
