import { z } from "zod";
import {
  MAX_MEMORIES,
  MEMORY_KIND_LABELS,
  MemoryLimitError,
  memoryTextSchema,
  type MemoryKind,
  type MemoryStore,
} from "../memory";
import type { ToolResult } from "../tool-result";
import { fail, ok } from "./shared";

export interface MemoryInput {
  accion: "agregar" | "actualizar" | "borrar";
  tipo?: MemoryKind;
  texto?: string;
  id?: string;
}

const idSchema = z.uuid();

/** Agrega, corrige o borra un recuerdo. Nunca guarda números de la cartera (`memoryTextSchema`). */
export async function updateMemory(
  store: MemoryStore,
  input: MemoryInput,
): Promise<ToolResult> {
  const source = { fn: "assistant_memory", detail: "memoria de largo plazo" };
  try {
    if (input.accion === "borrar") {
      if (!idSchema.safeParse(input.id).success)
        return fail("Falta el id del recuerdo.");
      return (await store.remove(input.id!))
        ? ok(source, { borrado: true })
        : fail("No encontré ese recuerdo.");
    }

    const text = memoryTextSchema.safeParse(input.texto ?? "");
    if (!text.success) {
      return fail(text.error.issues[0]?.message ?? "Texto inválido.");
    }
    if (input.accion === "actualizar") {
      if (!idSchema.safeParse(input.id).success)
        return fail("Falta el id del recuerdo.");
      const item = await store.update(input.id!, text.data);
      return item
        ? ok(source, { actualizado: { id: item.id, texto: item.content } })
        : fail("No encontré ese recuerdo.");
    }

    if (!input.tipo) return fail("Falta el tipo: risk_profile, goal o fact.");
    const item = await store.add(input.tipo, text.data);
    return ok(source, {
      guardado: {
        id: item.id,
        tipo: MEMORY_KIND_LABELS[item.kind],
        texto: item.content,
      },
    });
  } catch (error) {
    if (error instanceof MemoryLimitError) {
      return fail(
        `Ya hay ${MAX_MEMORIES} recuerdos: hay que borrar alguno antes de guardar otro.`,
      );
    }
    throw error;
  }
}
