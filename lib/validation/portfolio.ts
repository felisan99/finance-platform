import { z } from "zod";
import { BENCHMARK_SYMBOLS } from "@/lib/portfolio/benchmarks";

/** Mismos límites que la base (`portfolios_name_trimmed`, `portfolios_name_length`). */
export const PORTFOLIO_NAME_MAX = 40;
/** Mismo tope que el trigger `portfolios_check_limit`. */
export const MAX_PORTFOLIOS = 5;

// Controles, formato invisible y separadores de línea (como `cleanText`): un nombre es una línea.
const INVISIBLE_OR_CONTROL = new RegExp(
  String.raw`[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]`,
  "u",
);

/**
 * Nombre de un portafolio: una línea, sin espacios en los bordes ni repetidos, de 1 a 40
 * caracteres. Se rechaza (no se limpia en silencio) lo que tenga caracteres invisibles.
 */
export const portfolioNameSchema = z
  .string({ message: "Escribí un nombre" })
  .refine((value) => !INVISIBLE_OR_CONTROL.test(value), {
    message: "El nombre tiene caracteres no válidos",
  })
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Escribí un nombre")
      .max(PORTFOLIO_NAME_MAX, `Máximo ${PORTFOLIO_NAME_MAX} caracteres`),
  );

/** El benchmark elegido: uno de la lista corta (`BENCHMARKS`). */
export const benchmarkSchema = z.enum(BENCHMARK_SYMBOLS, {
  message: "Elegí contra qué comparar",
});

/** ¿Dos nombres chocan? La base los compara sin distinguir mayúsculas (`lower(name)`). */
export const sameName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();
