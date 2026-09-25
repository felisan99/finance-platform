import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import {
  FORMAT_SOURCE,
  parseImport,
  type ImportFormat,
  type ImportParseResult,
  type ImportSource,
} from "@/lib/importers";
import { getMarketDataProvider } from "@/lib/market-data";
import {
  resolveNewInstrument,
  type ResolveResult,
} from "@/lib/market-jobs/instruments";
import { buildImportPreview, type ImportPreview } from "./import-preview";
import { MAX_VERIFIED_SYMBOLS, verifyNewSymbols } from "./import-symbols";
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
  /** `null` si no se reconoció el formato (la vista trae el motivo y no se puede confirmar). */
  format: ImportFormat | null;
  /** Origen con el que se guarda (`delta_csv` o `csv`); `null` si no se reconoció el formato. */
  source: ImportSource | null;
  parsed: ImportParseResult;
  preview: ImportPreview;
}

export interface PrepareOptions {
  /** Importar también lo que parece repetir operaciones ya cargadas. */
  includeSuspected?: boolean;
  /**
   * Cómo verificar un símbolo nuevo del formato simple. Por defecto, con el proveedor de datos; los
   * tests de integración pasan uno propio para no salir a internet.
   */
  resolveSymbol?: (symbol: string) => Promise<ResolveResult>;
}

const resolveWithProvider = async (symbol: string): Promise<ResolveResult> =>
  resolveNewInstrument(await getMarketDataProvider(), symbol);

/**
 * Parsea el archivo (reconociendo el formato) y lo cruza con lo que ya hay en la cuenta. La vista
 * previa y la confirmación usan exactamente esta función: la confirmación NO reutiliza nada
 * calculado antes ni recibido del cliente, lo vuelve a derivar del archivo (así una vista previa
 * vieja no puede colar datos). Devuelve `null` si el usuario todavía no tiene cuenta.
 */
export async function prepareImport(
  client: SupabaseClient<Database>,
  text: string,
  now: Date,
  options: PrepareOptions = {},
): Promise<PreparedImport | null> {
  const account = await getPrimaryAccount(client);
  if (!account) return null;

  const { format, result: parsed } = parseImport(text, now);
  const source = format === null ? null : FORMAT_SOURCE[format];
  const rows = await getTransactionRows(client, account.id);
  const ids = [
    ...new Set(rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : []))),
  ];
  const instruments = await getInstruments(client, ids);
  const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));

  const known = await getInstrumentIdsBySymbol(client, [
    ...new Set(parsed.instruments.map((i) => i.symbol)),
  ]);

  // Un CSV escrito a mano puede traer un error de tipeo: sus símbolos nuevos se verifican con el
  // proveedor antes de crearlos (hasta un tope; de más, la vista pide importar en partes). Un export
  // de Delta lo genera una máquina y no se verifica.
  let symbolChecks: Map<string, ResolveResult> | null = null;
  if (format === "simple" && parsed.fatal === null) {
    const unknown = parsed.instruments
      .map((i) => i.symbol)
      .filter((symbol) => !known.has(symbol));
    symbolChecks = await verifyNewSymbols(
      options.resolveSymbol ?? resolveWithProvider,
      unknown.slice(0, MAX_VERIFIED_SYMBOLS),
    );
  }

  const preview = buildImportPreview({
    parsed,
    format,
    importedExternalIds: new Set(
      rows.flatMap((r) =>
        source !== null && r.source === source && r.external_id
          ? [r.external_id]
          : [],
      ),
    ),
    existingTransactions: rows.map((r) =>
      rowToTransaction(r, account.id, symbolById),
    ),
    knownSymbols: new Set(known.keys()),
    symbolChecks,
    includeSuspected: options.includeSuspected === true,
    accountId: account.id,
    now,
    currency: account.currency,
  });
  return { account, format, source, parsed, preview };
}
