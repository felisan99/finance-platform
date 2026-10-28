import { z } from "zod";
import { cleanText } from "@/lib/market-data/sanitize";

// Memoria de largo plazo del asistente: perfil de riesgo, objetivos y hechos estables que la
// persona contó ("invierto para jubilarme", "no quiero cripto"). Nunca números de la cartera: esos
// cambian todos los días y salen siempre del motor. La regla se aplica acá, no en el prompt.

export const MEMORY_KINDS = ["risk_profile", "goal", "fact"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  risk_profile: "Perfil de riesgo",
  goal: "Objetivo",
  fact: "Dato",
};

export const MAX_MEMORY_TEXT = 300;
export const MAX_MEMORIES = 30;

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  content: string;
  updatedAt: string;
}

// Montos, porcentajes, precios y cantidades: "US$ 5.000", "20 %", "1.234", "12,5", "300 acciones".
// Un número chico suelto ("en 10 años", "tengo 2 hijos") sí se puede guardar.
const LOOKS_LIKE_AMOUNT = [
  /[$€£%]/,
  /\b(usd|us\$|d[oó]lares?|pesos|euros?)\b/i,
  /\d{3,}/,
  /\d[.,]\d/,
];

export function looksLikePortfolioNumber(text: string): boolean {
  return LOOKS_LIKE_AMOUNT.some((pattern) => pattern.test(text));
}

export const memoryTextSchema = z
  .string()
  .transform((value) => cleanText(value, MAX_MEMORY_TEXT + 1) ?? "")
  .pipe(
    z
      .string()
      .min(3, "El recuerdo está vacío.")
      .max(MAX_MEMORY_TEXT, `Máximo ${MAX_MEMORY_TEXT} caracteres.`)
      .refine(
        (value) => !looksLikePortfolioNumber(value),
        "No guardo montos, porcentajes ni cantidades: esos datos salen siempre de la cartera.",
      ),
  );

export interface MemoryStore {
  list(): Promise<MemoryItem[]>;
  add(kind: MemoryKind, content: string): Promise<MemoryItem>;
  update(id: string, content: string): Promise<MemoryItem | null>;
  remove(id: string): Promise<boolean>;
}

/** Error esperable de la base (el tope de 30, código `AM001`) para devolverlo como mensaje. */
export class MemoryLimitError extends Error {}
