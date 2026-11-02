import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { getPerformance } from "../tools/performance";
import type { CaseExpectation } from "./score";

// Piezas comunes para armar las expectativas de los casos: la respuesta correcta sale de las tools.

export type Data = Record<string, unknown>;
export type Rows = Data[];

export async function data(result: Promise<ToolResult>): Promise<Data> {
  const resolved = await result;
  if (!resolved.ok) throw new Error(`eval: la tool falló: ${resolved.error}`);
  return resolved.data as Data;
}

export const str = (value: unknown): string => {
  if (typeof value !== "string")
    throw new Error(`eval: se esperaba texto: ${JSON.stringify(value)}`);
  return value;
};

export const numeric = (
  tools: string[],
  anchors: string[],
): CaseExpectation => ({
  kind: "numeric",
  tools,
  anchors,
});

export const period = async (ds: AssistantDataSource, id: string) =>
  ((await data(getPerformance(ds, {}))).periodos as Rows).find(
    (p) => p.periodo === id,
  )!;
