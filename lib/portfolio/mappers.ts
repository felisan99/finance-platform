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

/** Mediodía en Nueva York: el día de mercado de la operación es el del ex-dividendo. */
const exDateInstant = (exDate: string): Date =>
  new Date(`${exDate}T16:00:00.000Z`);

/**
 * Un dividendo propuesto y confirmado → las filas que se guardan: el `DIVIDEND` bruto y, si hay
 * retención, el `TAX` del mismo símbolo. `external_id` (`div:` / `divtax:` + el id de
 * `corporate_actions`) hace que la base rechace guardarlo dos veces en la misma cuenta. Los montos
 * vienen al centavo (`suggestDividends`), así que el número es exacto.
 */
export function dividendToInsertRows(
  suggestion: {
    eventId: string;
    exDate: string;
    gross: Dec;
    withholding: Dec;
  },
  ctx: {
    userId: string;
    accountId: string;
    instrumentId: string;
    currency: string;
  },
): TransactionInsert[] {
  const common = {
    user_id: ctx.userId,
    account_id: ctx.accountId,
    instrument_id: ctx.instrumentId,
    executed_at: exDateInstant(suggestion.exDate).toISOString(),
    currency: ctx.currency,
    source: "auto_dividend",
    // Todas las filas con las mismas columnas: al insertar varias juntas, PostgREST completa con
    // NULL (no con el default) las que falten en alguna, y `fee` es NOT NULL.
    fee: 0,
    notes: null,
  } as const;
  const rows: TransactionInsert[] = [
    {
      ...common,
      type: "DIVIDEND",
      amount: num(suggestion.gross),
      external_id: `div:${suggestion.eventId}`,
    },
  ];
  if (suggestion.withholding.gt(0)) {
    rows.push({
      ...common,
      type: "TAX",
      amount: num(suggestion.withholding),
      external_id: `divtax:${suggestion.eventId}`,
      notes: "Retención de EE. UU. sobre el dividendo",
    });
  }
  return rows;
}

/** Las mismas operaciones como `Transaction` del motor, para validar el libro antes de guardar. */
export function dividendToTransactions(
  suggestion: {
    eventId: string;
    symbol: string;
    exDate: string;
    gross: Dec;
    withholding: Dec;
  },
  ctx: { accountId: string; currency: string; now: Date },
): Transaction[] {
  const executedAt = exDateInstant(suggestion.exDate);
  const txs: Transaction[] = [
    {
      id: `div:${suggestion.eventId}`,
      accountId: ctx.accountId,
      type: "DIVIDEND",
      symbol: suggestion.symbol,
      amount: suggestion.gross,
      executedAt,
      createdAt: ctx.now,
      currency: ctx.currency,
    },
  ];
  if (suggestion.withholding.gt(0)) {
    txs.push({
      id: `divtax:${suggestion.eventId}`,
      accountId: ctx.accountId,
      type: "TAX",
      symbol: suggestion.symbol,
      amount: suggestion.withholding,
      executedAt,
      createdAt: ctx.now,
      currency: ctx.currency,
    });
  }
  return txs;
}
