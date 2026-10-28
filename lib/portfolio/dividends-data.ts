import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/db/database.types";
import { chunk, fetchAllPages } from "@/lib/db/paginate";
import {
  d,
  marketDay,
  suggestDividends,
  type Dec,
  type DividendEvent,
  type DividendSuggestion,
} from "@/lib/engine";
import type { PortfolioRef } from "./portfolio-scope";
import { parseRows } from "./rows";
import type { PortfolioSnapshot } from "./snapshot";

// Lecturas de los dividendos propuestos: los que detectó el cron (`corporate_actions`, datos de
// mercado), los que la persona descartó y su tasa de retención (RLS). El cálculo es del motor
// (`suggestDividends`), cuenta por cuenta.

type Client = SupabaseClient<Database>;
const loose = (client: Client) => client as unknown as SupabaseClient;

const IN_CHUNK = 100;
/** Si no hay perfil (no debería pasar: lo crea el alta), la retención sin convenio con EE. UU. */
export const DEFAULT_WITHHOLDING_RATE = "0.30";

const dividendRowSchema = z.object({
  id: z.string(),
  instrument_id: z.string(),
  ex_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string(),
});

const dismissalRowSchema = z.object({
  account_id: z.string(),
  corporate_action_id: z.string(),
});

export interface PendingDividend {
  /** `<cuenta>:<corporate_action>`: identifica la propuesta en los formularios. */
  key: string;
  portfolio: PortfolioRef;
  suggestion: DividendSuggestion;
}

export const pendingKey = (accountId: string, eventId: string): string =>
  `${accountId}:${eventId}`;

/** La retención de la persona (fracción, `0.30`). */
export async function getWithholdingRate(client: Client): Promise<Dec> {
  const { data, error } = await loose(client)
    .from("profiles")
    .select("dividend_withholding_rate::text")
    .maybeSingle();
  if (error) throw new Error(`db profiles: ${error.message}`);
  const parsed = z
    .object({ dividend_withholding_rate: z.string() })
    .nullable()
    .parse(data);
  return d(parsed?.dividend_withholding_rate ?? DEFAULT_WITHHOLDING_RATE);
}

/**
 * Los dividendos que el libro debería tener y no tiene, por cuenta, sin los descartados. Solo
 * mira los instrumentos que el alcance tuvo alguna vez y ex-dividendos desde la primera operación.
 */
export async function loadPendingDividends(
  client: Client,
  snapshot: PortfolioSnapshot,
  now: Date,
): Promise<{ rate: Dec; items: PendingDividend[] }> {
  const rate = await getWithholdingRate(client);
  if (snapshot.transactions.length === 0) return { rate, items: [] };

  const today = marketDay(now);
  const first = marketDay(snapshot.transactions[0]!.executedAt);
  const ids = [...snapshot.instrumentById.keys()];
  const accountIds = snapshot.parts.map((part) => part.portfolio.account.id);

  const [eventRows, dismissalRows] = await Promise.all([
    Promise.all(
      chunk(ids, IN_CHUNK).map((group) =>
        fetchAllPages((from, to) =>
          loose(client)
            .from("corporate_actions")
            .select("id, instrument_id, ex_date, amount::text")
            .eq("type", "DIVIDEND")
            .in("instrument_id", group)
            .gte("ex_date", first)
            .lte("ex_date", today)
            .order("ex_date")
            .order("id")
            .range(from, to),
        ),
      ),
    ).then((pages) =>
      parseRows(dividendRowSchema, pages.flat(), "corporate_actions"),
    ),
    Promise.all(
      chunk(accountIds, IN_CHUNK).map((group) =>
        fetchAllPages((from, to) =>
          loose(client)
            .from("dividend_dismissals")
            .select("account_id, corporate_action_id")
            .in("account_id", group)
            .order("account_id")
            .order("corporate_action_id")
            .range(from, to),
        ),
      ),
    ).then((pages) =>
      parseRows(dismissalRowSchema, pages.flat(), "dividend_dismissals"),
    ),
  ]);

  const events: DividendEvent[] = eventRows.flatMap((row) => {
    const symbol = snapshot.instrumentById.get(row.instrument_id)?.symbol;
    return symbol
      ? [{ id: row.id, symbol, exDate: row.ex_date, amount: d(row.amount) }]
      : [];
  });
  const dismissed = new Set(
    dismissalRows.map((row) =>
      pendingKey(row.account_id, row.corporate_action_id),
    ),
  );

  const items = snapshot.parts.flatMap((part) =>
    suggestDividends({
      transactions: part.transactions,
      events,
      withholdingRate: rate,
      today,
      options: { currency: part.portfolio.account.currency },
    })
      .map((suggestion) => ({
        key: pendingKey(part.portfolio.account.id, suggestion.eventId),
        portfolio: part.portfolio,
        suggestion,
      }))
      .filter((item) => !dismissed.has(item.key)),
  );
  items.sort((a, b) =>
    a.suggestion.exDate === b.suggestion.exDate
      ? a.key < b.key
        ? -1
        : 1
      : a.suggestion.exDate < b.suggestion.exDate
        ? 1
        : -1,
  );
  return { rate, items };
}
