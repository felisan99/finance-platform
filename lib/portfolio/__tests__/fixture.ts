import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { d } from "@/lib/engine";
import { parseDeltaCsv } from "@/lib/importers";
import { draftsToRpcRows } from "../mappers";
import type { InstrumentRow, TransactionRow } from "../rows";

/** Export de Delta del fixture: base de todos los tests de aceptación. */
export const FIXTURE_CSV = readFileSync(
  resolve(process.cwd(), "lib/engine/__fixtures__/delta_export.csv"),
  "utf8",
);

export const ACCOUNT_ID = "acc-1";

/**
 * Las transacciones del fixture como las devolvería la base: montos en texto con el redondeo de
 * `numeric(20,8)` (cantidad, precio, razón) y `numeric(20,4)` (monto, comisión) —decimal, mitad
 * hacia arriba, no de floats—, ids por símbolo y un `seq` creciente en el orden de inserción.
 */
export function fixtureRows(): TransactionRow[] {
  const { transactions } = parseDeltaCsv(FIXTURE_CSV);
  const fixed = (value: string | undefined, dp: number) =>
    value === undefined ? null : d(value).toFixed(dp);
  return draftsToRpcRows(transactions).map((r, i): TransactionRow => ({
    id: `db-${i}`,
    type: r.type,
    instrument_id: r.symbol === null ? null : `id-${r.symbol}`,
    executed_at: r.executed_at.replace("Z", "+00:00"),
    quantity: fixed(r.quantity, 8),
    price: fixed(r.price, 8),
    amount: fixed(r.amount, 4),
    fee: fixed(r.fee ?? "0", 4) as string,
    currency: r.currency,
    split_ratio: fixed(r.split_ratio, 8),
    notes: r.notes,
    source: "delta_csv",
    external_id: r.external_id,
    created_at: "2026-09-24T10:00:00+00:00",
    seq: i + 1,
  }));
}

export function fixtureInstruments(): InstrumentRow[] {
  return parseDeltaCsv(FIXTURE_CSV).instruments.map((i) => ({
    id: `id-${i.symbol}`,
    symbol: i.symbol,
    name: i.name,
    type: i.type,
    exchange: null,
    sector: null,
    provider_symbol: null,
  }));
}
