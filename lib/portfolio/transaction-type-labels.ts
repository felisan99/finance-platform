// Sin imports: lo usa un componente cliente y no debe arrastrar decimal.js ni zod.
export const TRANSACTION_TYPE_LABELS = {
  BUY: "Compra",
  SELL: "Venta",
  DIVIDEND: "Dividendo",
  DEPOSIT: "Depósito",
  WITHDRAWAL: "Retiro",
  INTEREST: "Interés",
  FEE: "Comisión",
  TAX: "Impuesto",
  SPLIT: "Split",
} as const;
