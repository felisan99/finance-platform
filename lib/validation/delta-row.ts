import { z } from "zod";

/** Columnas del export de Delta que el importador necesita; las demás se ignoran. */
export const DELTA_REQUIRED_COLUMNS = [
  "Date",
  "Way",
  "Base amount",
  "Base currency (name)",
  "Base type",
  "Quote amount",
  "Quote currency",
  "Fee amount",
  "Fee currency (name)",
  "Notes",
] as const;

/** Prefijo de las patas de efectivo que Delta genera solas junto a cada BUY/SELL (spec §8.2). */
export const SYNC_NOTE_PREFIX = "SYNC-BASE-HOLDINGS_";

// Solo valida la sintaxis: el motor convierte a Decimal (nunca a float). Acepta notación
// científica por si alguna exportación escribe cantidades muy chicas como 1e-7.
const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const decimalText = z
  .string({ error: "falta el campo" })
  .regex(DECIMAL_TEXT, "no es un número decimal");

const isoDate = z.iso.datetime({
  offset: true,
  error: "no es una fecha ISO 8601",
});
const requiredText = z
  .string({ error: "falta el campo" })
  .min(1, "falta el campo");

/**
 * Fila BUY/SELL. Los valores llegan normalizados por el importador: sin espacios
 * alrededor, campos vacíos como `undefined`, `Way` y `Base type` en mayúsculas.
 * OJO: `Quote amount` es el TOTAL de la operación, no el precio unitario.
 */
export const deltaTradeRowSchema = z.object({
  Date: isoDate,
  Way: z.enum(["BUY", "SELL"]),
  "Base amount": decimalText,
  "Base currency (name)": requiredText,
  "Base type": z.enum(["STOCK", "FUND"]),
  "Quote amount": decimalText,
  "Quote currency": requiredText,
  "Fee amount": decimalText.optional(),
  "Fee currency (name)": z.string().optional(),
  Notes: z.string().optional(),
});

/** Fila DEPOSIT/WITHDRAW de efectivo real (las patas SYNC se descartan antes). */
export const deltaCashRowSchema = z.object({
  Date: isoDate,
  Way: z.enum(["DEPOSIT", "WITHDRAW"]),
  "Base amount": decimalText,
  "Base currency (name)": requiredText,
  "Base type": z.literal("FIAT"),
  Notes: z.string().optional(),
});

export type DeltaTradeRow = z.infer<typeof deltaTradeRowSchema>;
export type DeltaCashRow = z.infer<typeof deltaCashRowSchema>;
