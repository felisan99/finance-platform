import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { parseDeltaCsv, type ImportParseResult } from "@/lib/importers";
import { buildImportPreview, type ImportPreview } from "./import-preview";
import { rowToTransaction } from "./mappers";
import {
  getInstrumentIdsBySymbol,
  getInstruments,
  getPrimaryAccount,
  getTransactionRows,
} from "./queries";
import type { AccountRow } from "./rows";

export interface PreparedImport {
  account: AccountRow;
  parsed: ImportParseResult;
  preview: ImportPreview;
}

/**
 * Parsea el archivo y lo cruza con lo que ya hay en la cuenta. La vista previa y la confirmación
 * usan exactamente esta función: la confirmación NO reutiliza nada calculado antes ni recibido del
 * cliente, lo vuelve a derivar del archivo (así una vista previa vieja no puede colar datos).
 * Devuelve `null` si el usuario todavía no tiene cuenta.
 */
export async function prepareImport(
  client: SupabaseClient<Database>,
  text: string,
  now: Date,
): Promise<PreparedImport | null> {
  const account = await getPrimaryAccount(client);
  if (!account) return null;

  const parsed = parseDeltaCsv(text);
  const rows = await getTransactionRows(client, account.id);
  const ids = [
    ...new Set(rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : []))),
  ];
  const instruments = await getInstruments(client, ids);
  const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));

  const known = await getInstrumentIdsBySymbol(client, [
    ...new Set(parsed.instruments.map((i) => i.symbol)),
  ]);

  const preview = buildImportPreview({
    parsed,
    importedExternalIds: new Set(
      rows.flatMap((r) =>
        r.source === "delta_csv" && r.external_id ? [r.external_id] : [],
      ),
    ),
    existingTransactions: rows.map((r) =>
      rowToTransaction(r, account.id, symbolById),
    ),
    knownSymbols: new Set(known.keys()),
    accountId: account.id,
    now,
    currency: account.currency,
  });
  return { account, parsed, preview };
}
