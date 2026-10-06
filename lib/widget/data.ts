import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/db/database.types";
import { buildDashboard } from "@/lib/portfolio/dashboard";
import {
  ALL_PORTFOLIOS,
  pickScope,
  portfoliosOfScope,
  scopeName,
} from "@/lib/portfolio/portfolio-scope";
import { snapshotFromRows, toPortfolioRefs } from "@/lib/portfolio/queries";
import {
  accountTransactionRowSchema,
  parseRows,
  type TransactionRow,
} from "@/lib/portfolio/rows";
import {
  defaultQuoteDeps,
  refreshStaleQuotes,
  type WidgetQuoteDeps,
} from "./quotes";
import { buildWidgetView, emptyWidgetView, type WidgetView } from "./view";

// Lectura del widget, sin sesión. Lo de la persona llega solo por `widget_ledger`, que fija de
// quién son los datos a partir del hash del token (la clave secreta no lee tablas de usuario); lo
// demás son datos de mercado. Antes de calcular, pide a Yahoo las cotizaciones de más de 2 horas
// (`quotes.ts`). Ver docs/decisions.md, "Widget de iPhone".

export type WidgetOutcome =
  | { kind: "ok"; view: WidgetView }
  /** El token no existe (nunca existió, se revocó o se reemplazó). */
  | { kind: "unknown" }
  | { kind: "limited" };

const ledgerSchema = z.union([
  z.null(),
  z.object({ limited: z.literal(true) }),
  z.object({
    limited: z.literal(false),
    portfolio_id: z.string().nullable(),
    portfolio_count: z.number(),
    portfolios: z.unknown(),
    transactions: z.unknown(),
  }),
]);

export async function loadWidget(
  admin: SupabaseClient<Database>,
  tokenHash: string,
  now: Date,
  quoteDeps: WidgetQuoteDeps = defaultQuoteDeps,
): Promise<WidgetOutcome> {
  const { data, error } = await admin.rpc("widget_ledger", {
    p_token_hash: tokenHash,
  });
  if (error) throw new Error(`db widget_ledger: ${error.message}`);
  const parsed = ledgerSchema.safeParse(data);
  if (!parsed.success) throw new Error("db widget_ledger: formato inesperado");
  const ledger = parsed.data;
  if (ledger === null) return { kind: "unknown" };
  if (ledger.limited) return { kind: "limited" };

  const portfolios = toPortfolioRefs(ledger.portfolios);
  const scope = pickScope(portfolios, ledger.portfolio_id ?? ALL_PORTFOLIOS);
  if (!scope) return { kind: "ok", view: emptyWidgetView(now) };

  const rows = parseRows(
    accountTransactionRowSchema,
    ledger.transactions,
    "widget_ledger transactions",
  );
  const byAccount = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    const list = byAccount.get(row.account_id);
    if (list) list.push(row);
    else byAccount.set(row.account_id, [row]);
  }
  const rowsByPortfolio = portfoliosOfScope(scope).map(
    (portfolio) => byAccount.get(portfolio.account.id) ?? [],
  );
  let snapshot = await snapshotFromRows(admin, scope, rowsByPortfolio);
  if (await refreshStaleQuotes(admin, tokenHash, snapshot, now, quoteDeps)) {
    snapshot = await snapshotFromRows(admin, scope, rowsByPortfolio);
  }

  const title = ledger.portfolio_count > 1 ? scopeName(scope) : null;
  return {
    kind: "ok",
    view: buildWidgetView(
      buildDashboard(snapshot.valued, snapshot.transactions, now),
      now,
      title,
    ),
  };
}
