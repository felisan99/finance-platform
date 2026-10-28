import { TOOL_LABELS } from "./tool-result";

// Red de seguridad para lo que se muestra: el prompt le pide al modelo no nombrar tools ni funciones
// internas, pero si igual escribe "(get_positions)" o "(computeTwr, 1A: …)", esa cita no le dice
// nada a la persona. Las fuentes ya están, en palabras, en "De dónde salen los números". Sin imports
// pesados: lo usa el cliente.

const ENGINE_FUNCTIONS = [
  "valuePortfolio",
  "computeTwr",
  "computeXirr",
  "realizedEvents",
  "summarizeRealized",
  "contributionBetween",
  "summarizeCloses",
  "simulateAddition",
  "simulateMonthlyPlan",
  "simulateTrades",
  "computeRisk",
  "computeAllocation",
  "assistant_memory",
];

const NAMES = [...Object.keys(TOOL_LABELS), ...ENGINE_FUNCTIONS];
const NAME = new RegExp(`\\b(${NAMES.join("|")})\\b|source\\.(fn|detail)`);
const PARENTHETICAL = /\s?\(([^()\n]*)\)/g;
const BACKTICKED = new RegExp(`\`(${NAMES.join("|")})\``, "g");

/**
 * Saca de un texto del asistente los paréntesis que citan un nombre interno y los nombres internos
 * entre comillas invertidas. No toca paréntesis comunes ("(VOO)", "(en dólares)").
 */
export function stripInternalRefs(text: string): string {
  return text
    .replace(PARENTHETICAL, (whole, inner: string) =>
      NAME.test(inner) ? "" : whole,
    )
    .replace(BACKTICKED, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.:;])/g, "$1");
}
