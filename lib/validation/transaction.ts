import { z } from "zod";
import { D, d, type Dec } from "@/lib/engine";
import { cleanText } from "@/lib/market-data/sanitize";
import { parseLocalInput } from "@/lib/portfolio/time";

// Validación del formulario de alta y edición de transacciones (spec §10.3). Entrada: strings del
// FormData. Salida: valores tipados, con `Dec` para los montos. Acepta coma o punto decimal.
//
// Los límites de dígitos no son caprichosos: los montos se convierten a número recién al escribir
// en la base, y un double solo es exacto hasta 15 cifras significativas (7 enteros + 8 decimales en
// cantidad y precio; 11 + 4 en montos y comisión). Con menos o esas cifras no se pierde nada.

export const SYMBOL_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
export const MAX_NOTES = 500;
const MIN_DATE = new Date("1990-01-01T00:00:00Z");
const MAX_FUTURE_MS = 24 * 3_600_000;

/** `brk.b` / ` BRK B ` → `BRK-B`: lo que suele escribir la gente para las clases de acciones. */
export function normalizeSymbol(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[.\s]+/g, "-");
}

export interface DecimalRules {
  maxInt: number;
  maxDecimals: number;
  /** `positive`: > 0. `nonNegative`: ≥ 0. `nonZero`: ≠ 0 y admite negativos (interés de margen). */
  rule: "positive" | "nonNegative" | "nonZero";
}

const DECIMAL_MESSAGES = {
  format: "Escribí un número (por ejemplo 12,5)",
  separators: "Usá un solo separador decimal, sin separador de miles",
  positive: "Tiene que ser mayor que 0",
  nonNegative: "No puede ser negativo",
  nonZero: "No puede ser 0",
} as const;

/** Texto → decimal, o el mensaje de error. Sin notación científica ni separador de miles. */
export function parseDecimalText(
  raw: string,
  rules: DecimalRules,
): { ok: true; value: Dec } | { ok: false; message: string } {
  const text = raw.trim();
  if (text === "") return { ok: false, message: DECIMAL_MESSAGES.format };
  const commas = (text.match(/,/g) ?? []).length;
  const dots = (text.match(/\./g) ?? []).length;
  if (commas + dots > 1)
    return { ok: false, message: DECIMAL_MESSAGES.separators };

  // Un negativo donde no corresponde tiene su propio mensaje (no el de "máximo de dígitos").
  if (text.startsWith("-") && rules.rule !== "nonZero" && /^-\d/.test(text)) {
    return {
      ok: false,
      message:
        rules.rule === "positive"
          ? DECIMAL_MESSAGES.positive
          : DECIMAL_MESSAGES.nonNegative,
    };
  }

  const negative = rules.rule === "nonZero" ? "-?" : "";
  const shape = new RegExp(
    `^${negative}\\d{1,${rules.maxInt}}(\\.\\d{1,${rules.maxDecimals}})?$`,
  );
  const normalized = text.replace(",", ".");
  if (!shape.test(normalized)) {
    return {
      ok: false,
      message: /^-?\d+([.,]\d+)?$/.test(text)
        ? `Máximo ${rules.maxInt} dígitos enteros y ${rules.maxDecimals} decimales`
        : DECIMAL_MESSAGES.format,
    };
  }

  const value = d(normalized);
  if (rules.rule === "positive" && !value.gt(0))
    return { ok: false, message: DECIMAL_MESSAGES.positive };
  if (rules.rule === "nonNegative" && value.lt(0))
    return { ok: false, message: DECIMAL_MESSAGES.nonNegative };
  if (rules.rule === "nonZero" && value.isZero())
    return { ok: false, message: DECIMAL_MESSAGES.nonZero };
  return { ok: true, value };
}

function decimalField(rules: DecimalRules) {
  return z.string({ error: DECIMAL_MESSAGES.format }).transform((raw, ctx) => {
    const parsed = parseDecimalText(raw, rules);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });
      return z.NEVER;
    }
    return parsed.value;
  });
}

const quantityField = decimalField({
  maxInt: 7,
  maxDecimals: 8,
  rule: "positive",
});
const priceField = decimalField({
  maxInt: 7,
  maxDecimals: 8,
  rule: "nonNegative",
});
const feeField = decimalField({
  maxInt: 11,
  maxDecimals: 4,
  rule: "nonNegative",
});
const amountField = decimalField({
  maxInt: 11,
  maxDecimals: 4,
  rule: "positive",
});
const signedAmountField = decimalField({
  maxInt: 11,
  maxDecimals: 4,
  rule: "nonZero",
});
const splitPartField = decimalField({
  maxInt: 7,
  maxDecimals: 8,
  rule: "positive",
});

const symbolField = z
  .string({ error: "Elegí un símbolo" })
  .transform(normalizeSymbol)
  .pipe(
    z
      .string()
      .min(1, "Elegí un símbolo")
      .max(15, "Símbolo demasiado largo")
      .regex(
        SYMBOL_PATTERN,
        "Símbolo inválido: letras y números (para clases usá guion, como BRK-B)",
      ),
  );

const notesField = z
  .string()
  .max(2000, `Máximo ${MAX_NOTES} caracteres`)
  .optional()
  .transform((raw, ctx) => {
    const cleaned = cleanText(raw ?? "", 2000);
    if (cleaned !== null && cleaned.length > MAX_NOTES) {
      ctx.addIssue({
        code: "custom",
        message: `Máximo ${MAX_NOTES} caracteres`,
      });
      return z.NEVER;
    }
    return cleaned;
  });

/**
 * Mensaje si la fecha de una operación no es razonable (futura o de antes de 1990); `null` si está
 * bien. `now` entra por parámetro: el formulario y los importadores comparten la misma regla.
 */
export function dateRangeError(instant: Date, now: Date): string | null {
  if (instant.getTime() > now.getTime() + MAX_FUTURE_MS)
    return "La fecha no puede ser futura";
  if (instant < MIN_DATE) return "La fecha es demasiado antigua";
  return null;
}

/** Los campos comunes; `now` fija el límite de "fecha futura" sin leer el reloj adentro. */
function executedAtField(now: Date) {
  return z
    .string({ error: "Elegí la fecha y la hora" })
    .transform((raw, ctx) => {
      const instant = parseLocalInput(raw);
      if (!instant) {
        ctx.addIssue({ code: "custom", message: "Fecha y hora inválidas" });
        return z.NEVER;
      }
      const problem = dateRangeError(instant, now);
      if (problem) {
        ctx.addIssue({ code: "custom", message: problem });
        return z.NEVER;
      }
      return instant;
    });
}

/** Razón de un split a partir de "nuevas por cada viejas" (10 por 1 → 10; 1 por 10 → 0,1). */
export function splitRatio(newShares: Dec, oldShares: Dec): Dec | null {
  const ratio = newShares.div(oldShares).toDecimalPlaces(8, D.ROUND_HALF_UP);
  return ratio.gt(0) ? ratio : null;
}

export interface CommonFields {
  executedAt: Date;
  notes: string | null;
}

export type TransactionInput =
  | (CommonFields & {
      type: "BUY" | "SELL";
      symbol: string;
      quantity: Dec;
      price: Dec;
      fee: Dec;
    })
  | (CommonFields & { type: "DIVIDEND"; symbol: string; amount: Dec })
  | (CommonFields & { type: "SPLIT"; symbol: string; splitRatio: Dec })
  | (CommonFields & {
      type: "DEPOSIT" | "WITHDRAWAL" | "FEE" | "TAX" | "INTEREST";
      symbol: null;
      amount: Dec;
    });

export { TRANSACTION_TYPE_LABELS } from "@/lib/portfolio/transaction-type-labels";

const typeField = z.enum(
  [
    "BUY",
    "SELL",
    "DIVIDEND",
    "DEPOSIT",
    "WITHDRAWAL",
    "INTEREST",
    "FEE",
    "TAX",
    "SPLIT",
  ],
  { error: "Elegí el tipo de operación" },
);

/** Valores crudos del formulario (`Object.fromEntries(formData)`); lo que falte llega `undefined`. */
export type RawTransactionForm = Partial<
  Record<
    | "type"
    | "symbol"
    | "quantity"
    | "price"
    | "fee"
    | "amount"
    | "splitNew"
    | "splitOld"
    | "executedAt"
    | "notes",
    FormDataEntryValue | null
  >
>;

export type TransactionFormResult =
  | { ok: true; data: TransactionInput }
  | { ok: false; errors: Partial<Record<string, string>> };

const str = (
  value: FormDataEntryValue | null | undefined,
): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Valida el formulario. Devuelve, por campo, el primer mensaje de error (en español) para
 * mostrarlo junto al campo. Los campos que no corresponden al tipo elegido se ignoran.
 */
export function parseTransactionForm(
  raw: RawTransactionForm,
  now: Date,
): TransactionFormResult {
  const kind = typeField.safeParse(str(raw.type));
  if (!kind.success)
    return { ok: false, errors: { type: kind.error.issues[0]?.message } };

  const common = z.object({
    executedAt: executedAtField(now),
    notes: notesField,
  });
  const commonInput = {
    executedAt: str(raw.executedAt),
    notes: str(raw.notes),
  };

  let schema: z.ZodType<TransactionInput>;
  let input: Record<string, unknown>;

  switch (kind.data) {
    case "BUY":
    case "SELL": {
      const type = kind.data;
      schema = common
        .extend({
          symbol: symbolField,
          quantity: quantityField,
          price: priceField,
          fee: feeField,
        })
        .transform((v) => ({ type, ...v }));
      input = {
        ...commonInput,
        symbol: str(raw.symbol),
        quantity: str(raw.quantity),
        price: str(raw.price),
        fee: str(raw.fee) || "0",
      };
      break;
    }
    case "DIVIDEND":
      schema = common
        .extend({ symbol: symbolField, amount: amountField })
        .transform((v) => ({ type: "DIVIDEND" as const, ...v }));
      input = {
        ...commonInput,
        symbol: str(raw.symbol),
        amount: str(raw.amount),
      };
      break;
    case "SPLIT":
      schema = common
        .extend({
          symbol: symbolField,
          splitNew: splitPartField,
          splitOld: splitPartField,
        })
        .transform((v, ctx) => {
          const ratio = splitRatio(v.splitNew, v.splitOld);
          if (!ratio || ratio.eq(1)) {
            ctx.addIssue({
              code: "custom",
              path: ["splitNew"],
              message: ratio
                ? "Un split 1 por 1 no cambia nada"
                : "La razón del split está fuera de rango",
            });
            return z.NEVER;
          }
          return {
            type: "SPLIT" as const,
            symbol: v.symbol,
            splitRatio: ratio,
            executedAt: v.executedAt,
            notes: v.notes,
          };
        });
      input = {
        ...commonInput,
        symbol: str(raw.symbol),
        splitNew: str(raw.splitNew),
        splitOld: str(raw.splitOld),
      };
      break;
    case "INTEREST":
      schema = common
        .extend({ amount: signedAmountField })
        .transform((v) => ({ type: "INTEREST" as const, symbol: null, ...v }));
      input = { ...commonInput, amount: str(raw.amount) };
      break;
    default: {
      const type = kind.data;
      schema = common
        .extend({ amount: amountField })
        .transform((v) => ({ type, symbol: null, ...v }));
      input = { ...commonInput, amount: str(raw.amount) };
    }
  }

  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };

  const errors: Partial<Record<string, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}
