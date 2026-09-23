import type { Dec } from "./decimal";

export type TxType =
  | "BUY"
  | "SELL"
  | "DIVIDEND"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "FEE"
  | "INTEREST"
  | "SPLIT"
  | "TAX";

// FIFO llega en la Fase 8 (spec §14.2); hoy solo existe costo promedio.
export type CostMethod = "AVERAGE";

interface TxBase {
  id: string;
  accountId: string;
  /** Instante UTC de la operación. */
  executedAt: Date;
  /** Desempate estable entre operaciones con el mismo `executedAt`. */
  createdAt: Date;
  currency: string;
  notes?: string | null;
}

// Unión discriminada: cada tipo trae solo los campos que le corresponden.
export type TradeTx = TxBase & {
  type: "BUY" | "SELL";
  symbol: string;
  quantity: Dec;
  /** Precio unitario SIN comisión. */
  price: Dec;
  fee: Dec;
};

export type DividendTx = TxBase & {
  type: "DIVIDEND";
  symbol: string;
  amount: Dec;
};

export type SplitTx = TxBase & {
  type: "SPLIT";
  symbol: string;
  /** Acciones nuevas / viejas: 10 para un split 10:1, 0.1 para un inverso 1:10. */
  splitRatio: Dec;
};

/** Movimientos de efectivo de la cuenta. `symbol` es opcional (p. ej. una retención de un dividendo). */
export type CashTx = TxBase & {
  type: "DEPOSIT" | "WITHDRAWAL" | "INTEREST" | "FEE" | "TAX";
  symbol: string | null;
  amount: Dec;
};

export type Transaction = TradeTx | DividendTx | SplitTx | CashTx;

/** Libro mayor de un símbolo, abierto o cerrado. */
export interface Position {
  symbol: string;
  /** Exactamente 0 si la posición está cerrada. */
  quantity: Dec;
  /** Incluye las comisiones de compra. */
  costBasis: Dec;
  /** `null` si `quantity` es 0. */
  avgCost: Dec | null;
  /** Acumulado histórico: sobrevive al cierre de la posición. */
  realizedPnl: Dec;
  dividends: Dec;
  isOpen: boolean;
}

export interface EngineTotals {
  /** Σ costo base de las posiciones abiertas. */
  openCostBasis: Dec;
  realizedPnl: Dec;
  dividends: Dec;
  interest: Dec;
  fees: Dec;
  taxes: Dec;
  /** Flujos externos: Σ DEPOSIT y Σ WITHDRAWAL (ambos en positivo). */
  deposits: Dec;
  withdrawals: Dec;
}

export type EngineIssue =
  | {
      severity: "error";
      code: "SELL_EXCEEDS_HOLDINGS";
      txId: string;
      symbol: string;
      requested: Dec;
      available: Dec;
    }
  | {
      severity: "error";
      code: "UNSUPPORTED_CURRENCY" | "INVALID_TRANSACTION";
      txId: string;
      message: string;
    }
  | {
      severity: "warning";
      code: "SPLIT_WITHOUT_POSITION";
      txId: string;
      symbol: string;
    }
  // Solo sobre el saldo final: una compra puede anticiparse al depósito que la fondea.
  | { severity: "warning"; code: "NEGATIVE_CASH"; cash: Dec };

export interface EngineOptions {
  costMethod?: CostMethod;
  /** Moneda soportada; v1 solo USD (spec §15). */
  currency?: string;
}

export interface EngineResult {
  /** Todos los símbolos con actividad, abiertos y cerrados, ordenados por símbolo. */
  positions: Position[];
  cash: Dec;
  totals: EngineTotals;
  issues: EngineIssue[];
}
