import { createHash } from "node:crypto";
import type { ToolSet } from "ai";

// Datos para reproducir una corrida de evals: qué prompt, qué tools y qué ajustes se usaron.

export type EvalMode = "agent" | "sin_tools";

export const modeLabel = (mode: EvalMode): string =>
  mode === "agent" ? "agent" : "sin tools";

export const sha256 = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** Hash de los nombres y descripciones de las tools (lo que el modelo lee para elegirlas). */
export function toolDescriptionsHash(tools: ToolSet): string {
  const entries = Object.keys(tools)
    .sort()
    .map((name) => [name, tools[name]?.description ?? ""]);
  return sha256(JSON.stringify(entries));
}

export interface RunMetadata {
  date: string;
  commit: string | null;
  mode: EvalMode;
  split: string | null;
  runs: number;
  /** Ids tal como se pidieron. */
  modelsRequested: string[];
  /** Ids que devolvió el proveedor, por modelo pedido (puede ser distinto: alias, versiones). */
  modelsServed: Record<string, string[]>;
  systemPromptSha256: string;
  toolDescriptionsSha256: string;
  /** Variables `EVAL_*` (no llevan secretos). */
  settings: Record<string, string>;
}

export function evalSettings(
  env: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([k, v]) =>
      k.startsWith("EVAL_") && v !== undefined ? [[k, v]] : [],
    ),
  );
}
