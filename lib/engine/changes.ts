import { computeEngine } from "./engine";
import type {
  EngineIssue,
  EngineOptions,
  EngineResult,
  Transaction,
} from "./types";

// Validación de un cambio del libro (alta, edición o baja de una transacción) antes de guardarlo.
// El alta y la edición rechazan la operación si aparece un `error` nuevo; las advertencias (p. ej.
// efectivo negativo) se informan pero no bloquean (docs/decisions.md, Fase 1).

export type LedgerChange =
  | { kind: "add"; tx: Transaction }
  /** Varias altas juntas (una importación): se valida el conjunto, no una por una. */
  | { kind: "addMany"; txs: readonly Transaction[] }
  | { kind: "replace"; id: string; tx: Transaction }
  | { kind: "remove"; id: string };

export interface ChangeCheck {
  /** `true` si el cambio no introduce errores nuevos. */
  ok: boolean;
  /** Errores que antes no estaban (por código y transacción). Bloquean el cambio. */
  newErrors: EngineIssue[];
  /** Advertencias que antes no estaban. No bloquean. */
  newWarnings: EngineIssue[];
  /** El libro mayor tal como quedaría con el cambio aplicado. */
  after: EngineResult;
}

/**
 * Identidad de un issue para saber si ya existía: el código y la transacción. Los importes de un
 * error (pedido, disponible) cambian al editar y no lo vuelven "otro" error. Las advertencias
 * globales (`NEGATIVE_CASH`) no tienen transacción.
 */
const issueKey = (issue: EngineIssue) =>
  `${issue.code}|${"txId" in issue ? issue.txId : ""}`;

function apply(
  existing: readonly Transaction[],
  change: LedgerChange,
): Transaction[] {
  switch (change.kind) {
    case "add":
      return [...existing, change.tx];
    case "addMany":
      return [...existing, ...change.txs];
    case "replace": {
      if (!existing.some((tx) => tx.id === change.id)) {
        throw new RangeError(`No existe la transacción ${change.id}`);
      }
      return existing.map((tx) => (tx.id === change.id ? change.tx : tx));
    }
    case "remove": {
      if (!existing.some((tx) => tx.id === change.id)) {
        throw new RangeError(`No existe la transacción ${change.id}`);
      }
      return existing.filter((tx) => tx.id !== change.id);
    }
  }
}

/**
 * Aplica `change` a `existing` (sin mutarlo) y compara los issues del libro antes y después. Un
 * libro que ya tenía errores (por ejemplo, datos importados con problemas) no bloquea cambios que
 * no agreguen otros nuevos. Lanza `RangeError` si `id` no existe (error de uso, no de datos).
 */
export function validateLedgerChange(
  existing: readonly Transaction[],
  change: LedgerChange,
  options: EngineOptions = {},
): ChangeCheck {
  const before = computeEngine(existing, options);
  const after = computeEngine(apply(existing, change), options);

  const known = new Set(before.issues.map(issueKey));
  const introduced = after.issues.filter(
    (issue) => !known.has(issueKey(issue)),
  );
  const newErrors = introduced.filter((issue) => issue.severity === "error");
  const newWarnings = introduced.filter(
    (issue) => issue.severity === "warning",
  );

  return { ok: newErrors.length === 0, newErrors, newWarnings, after };
}
