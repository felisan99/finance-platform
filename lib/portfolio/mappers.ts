import type { Database } from "@/lib/db/database.types";
import { d, type Dec, type Transaction } from "@/lib/engine";
import type { TransactionDraft } from "@/lib/importers";
import type { TransactionInput } from "@/lib/validation/transaction";
import type { TransactionRow, TxTypeName } from "./rows";

function need(value: string | null, field: string, id: string): Dec {
  if (value === null) {
    // Los CHECK de `transactions` lo impiden: si pasa, la base tiene datos inconsistentes.
    throw new Error(`La transacción ${id} no tiene ${field}`);
  }
  return d(value);
}

/**
 * Fila de `transactions` (con los `numeric` como texto) → `Transaction` del motor. `symbolById`
 * resuelve `instrument_id` → símbolo.
 */
export function rowToTransaction(
  row: TransactionRow,
  accountId: string,
  symbolById: ReadonlyMap<string, string>,
): Transaction {
  const symbol =
    row.instrument_id === null
      ? null
      : (symbolById.get(row.instrument_id) ?? null);
  const base = {
    id: row.id,
    accountId,
    executedAt: new Date(row.executed_at),
    createdAt: new Date(row.created_at),
    currency: row.currency,
    notes: row.notes,
  };
  const requireSymbol = (): string => {
    if (symbol === null) {
      throw new Error(`La transacción ${row.id} no tiene instrumento`);
    }
    return symbol;
  };

  switch (row.type) {
    case "BUY":
    case "SELL":
      return {
        ...base,
        type: row.type,
        symbol: requireSymbol(),
        quantity: need(row.quantity, "cantidad", row.id),
        price: need(row.price, "precio", row.id),
        fee: d(row.fee),
      };
    case "DIVIDEND":
      return {
        ...base,
        type: "DIVIDEND",
        symbol: requireSymbol(),
        amount: need(row.amount, "monto", row.id),
      };
    case "SPLIT":
      return {
        ...base,
        type: "SPLIT",
        symbol: requireSymbol(),
        splitRatio: need(row.split_ratio, "razón del split", row.id),
      };
    case "DEPOSIT":
    case "WITHDRAWAL":
    case "FEE":
    case "TAX":
    case "INTEREST":
      return {
        ...base,
        type: row.type,
        symbol,
        amount: need(row.amount, "monto", row.id),
      };
  }
}

/** Objeto de `p_rows` del RPC `import_transactions`: los montos viajan como strings decimales. */
export interface ImportRpcRow {
  type: TxTypeName;
  symbol: string | null;
  executed_at: string;
  quantity?: string;
  price?: string;
  amount?: string;
  fee?: string;
  currency: string;
  split_ratio?: string;
  notes: string | null;
  external_id: string;
}

/** Borradores del importador → filas del RPC, en el mismo orden (define el `seq` de inserción). */
export function draftsToRpcRows(
  drafts: readonly TransactionDraft[],
): ImportRpcRow[] {
  return drafts.map((draft): ImportRpcRow => {
    const base = {
      executed_at: draft.executedAt.toISOString(),
      currency: draft.currency,
      notes: draft.notes ?? null,
      external_id: draft.externalId,
    };
    switch (draft.type) {
      case "BUY":
      case "SELL":
        return {
          ...base,
          type: draft.type,
          symbol: draft.symbol,
          quantity: draft.quantity.toFixed(),
          price: draft.price.toFixed(),
          fee: draft.fee.toFixed(),
        };
      case "DIVIDEND":
        return {
          ...base,
          type: "DIVIDEND",
          symbol: draft.symbol,
          amount: draft.amount.toFixed(),
        };
      case "SPLIT":
        return {
          ...base,
          type: "SPLIT",
          symbol: draft.symbol,
          split_ratio: draft.splitRatio.toFixed(),
        };
      case "DEPOSIT":
      case "WITHDRAWAL":
      case "FEE":
      case "TAX":
      case "INTEREST":
        return {
          ...base,
          type: draft.type,
          symbol: draft.symbol,
          amount: draft.amount.toFixed(),
        };
    }
  });
}

/** Transacción del formulario → `Transaction` del motor (para validar el cambio antes de guardarlo). */
export function inputToTransaction(
  input: TransactionInput,
  ctx: { id: string; accountId: string; createdAt: Date; currency?: string },
): Transaction {
  const base = {
    id: ctx.id,
    accountId: ctx.accountId,
    executedAt: input.executedAt,
    createdAt: ctx.createdAt,
    currency: ctx.currency ?? "USD",
    notes: input.notes,
  };
  switch (input.type) {
    case "BUY":
    case "SELL":
      return {
        ...base,
        type: input.type,
        symbol: input.symbol,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
      };
    case "DIVIDEND":
      return {
        ...base,
        type: "DIVIDEND",
        symbol: input.symbol,
        amount: input.amount,
      };
    case "SPLIT":
      return {
        ...base,
        type: "SPLIT",
        symbol: input.symbol,
        splitRatio: input.splitRatio,
      };
    default:
      return { ...base, type: input.type, symbol: null, amount: input.amount };
  }
}

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

/**
 * Los montos se convierten a número recién acá, en el borde con la base. Es lossless: el
 * formulario limita los dígitos a 15 cifras significativas (`lib/validation/transaction.ts`) y
 * `JSON.stringify` serializa un double con su representación más corta ("251.41").
 */
const num = (value: Dec): number => Number(value.toFixed());

/**
 * Columnas de valor de una transacción, todas explícitas (con `null` en las que no corresponden):
 * al editar un BUY para convertirlo en DEPOSIT, la cantidad y el precio viejos tienen que borrarse.
 */
export function inputToValueColumns(
  input: TransactionInput,
  instrumentId: string | null,
): Required<
  Pick<
    TransactionUpdate,
    | "type"
    | "instrument_id"
    | "executed_at"
    | "quantity"
    | "price"
    | "amount"
    | "fee"
    | "split_ratio"
    | "notes"
  >
> {
  const base = {
    type: input.type,
    instrument_id: instrumentId,
    executed_at: input.executedAt.toISOString(),
    notes: input.notes,
  };
  switch (input.type) {
    case "BUY":
    case "SELL":
      return {
        ...base,
        quantity: num(input.quantity),
        price: num(input.price),
        amount: null,
        fee: num(input.fee),
        split_ratio: null,
      };
    case "DIVIDEND":
      return {
        ...base,
        quantity: null,
        price: null,
        amount: num(input.amount),
        fee: 0,
        split_ratio: null,
      };
    case "SPLIT":
      return {
        ...base,
        quantity: null,
        price: null,
        amount: null,
        fee: 0,
        split_ratio: num(input.splitRatio),
      };
    default:
      return {
        ...base,
        quantity: null,
        price: null,
        amount: num(input.amount),
        fee: 0,
        split_ratio: null,
      };
  }
}

/** Fila para insertar una transacción manual. */
export function inputToInsertRow(
  input: TransactionInput,
  ctx: { userId: string; accountId: string; instrumentId: string | null },
): TransactionInsert {
  return {
    ...inputToValueColumns(input, ctx.instrumentId),
    user_id: ctx.userId,
    account_id: ctx.accountId,
    currency: "USD",
    source: "manual",
  };
}
