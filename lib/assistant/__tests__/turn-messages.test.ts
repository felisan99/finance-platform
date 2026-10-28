import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { appendMessages } from "../conversation-store";
import { historyWithQuestion, messagesToPersist } from "../turn-messages";

const text = (id: string, role: "user" | "assistant", body: string) =>
  ({ id, role, parts: [{ type: "text", text: body }] }) as UIMessage;

const q1 = text("q1", "user", "¿Cuánto vale mi cartera?");
const a1 = text("a1", "assistant", "Vale 1.000 US$.");
const q2 = text("q2", "user", "¿Y el mes pasado?");

interface Row {
  seq: number;
  ui_id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  message: UIMessage;
}

/**
 * Un cliente falso con la tabla en memoria. `upsert` con `ignoreDuplicates` se comporta como
 * `insert ... on conflict (conversation_id, ui_id) do nothing`.
 */
function fakeClient() {
  const table: Row[] = [];
  const calls: { method: string; rows: unknown[]; options?: unknown }[] = [];
  let seq = 0;
  const conflicts = (r: Omit<Row, "seq">) =>
    table.some(
      (t) => t.conversation_id === r.conversation_id && t.ui_id === r.ui_id,
    );
  const client = {
    from(name: string) {
      expect(name).toBe("assistant_messages");
      return {
        async upsert(
          rows: Omit<Row, "seq">[],
          options: { onConflict?: string; ignoreDuplicates?: boolean },
        ) {
          calls.push({ method: "upsert", rows, options });
          if (
            options.onConflict !== "conversation_id,ui_id" ||
            !options.ignoreDuplicates
          ) {
            return { error: { message: "upsert no soportado en el fake" } };
          }
          for (const r of rows) {
            if (!conflicts(r)) table.push({ ...r, seq: ++seq });
          }
          return { error: null };
        },
      };
    },
  };
  const stored = (conversationId = "c") =>
    table
      .filter((r) => r.conversation_id === conversationId)
      .sort((a, b) => a.seq - b.seq);
  return {
    // El tipo real del cliente de Supabase es enorme; el fake implementa solo lo que se usa.
    client: client as unknown as Parameters<typeof appendMessages>[0],
    calls,
    stored,
  };
}

describe("historyWithQuestion", () => {
  it("agrega la pregunta nueva al final", () => {
    expect(historyWithQuestion([q1, a1], q2)).toEqual([q1, a1, q2]);
    expect(historyWithQuestion([], q1)).toEqual([q1]);
  });

  it("reintento: si lo último guardado es la misma pregunta, no la repite", () => {
    const retried = text("q2", "user", "¿Y el mes pasado?");
    const history = historyWithQuestion([q1, a1, q2], retried);
    expect(history).toEqual([q1, a1, q2]);
    expect(history.filter((m) => m.id === "q2")).toHaveLength(1);
  });

  it("usa la copia guardada aunque el texto reenviado sea otro (es la que queda en la base)", () => {
    const changed = text("q2", "user", "otro texto");
    expect(historyWithQuestion([q1, a1, q2], changed).at(-1)).toBe(q2);
  });

  it("solo deduplica contra el último mensaje si es de la persona", () => {
    const sameIdAsAnswer = text("a1", "user", "¿Y?");
    expect(historyWithQuestion([q1, a1], sameIdAsAnswer)).toEqual([
      q1,
      a1,
      sameIdAsAnswer,
    ]);
    const other = text("q3", "user", "Otra");
    expect(historyWithQuestion([q1, a1, q2], other)).toEqual([
      q1,
      a1,
      q2,
      other,
    ]);
  });

  it("no modifica lo guardado", () => {
    const stored = [q1, a1, q2];
    historyWithQuestion(stored, q2).push(a1);
    expect(stored).toEqual([q1, a1, q2]);
  });
});

describe("messagesToPersist", () => {
  const answer = text("msg-1", "assistant", "Bajó 2 %.");

  it("turno normal: la pregunta y la respuesta", () => {
    const history = [q1, a1, q2];
    expect(messagesToPersist([...history, answer], history, q2)).toEqual([
      q2,
      answer,
    ]);
  });

  it("si falló o no terminó: solo la pregunta", () => {
    expect(messagesToPersist(null, [q1, a1, q2], q2)).toEqual([q2]);
  });
});

describe("appendMessages", () => {
  it("guarda con on conflict (conversation_id, ui_id) do nothing y filas con las mismas columnas", async () => {
    const fake = fakeClient();
    await appendMessages(fake.client, "u", "c", [q1, a1]);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.method).toBe("upsert");
    expect(call.options).toEqual({
      onConflict: "conversation_id,ui_id",
      ignoreDuplicates: true,
    });
    const keys = call.rows.map((r) => Object.keys(r as object).sort());
    expect(keys[0]).toEqual([
      "conversation_id",
      "message",
      "role",
      "ui_id",
      "user_id",
    ]);
    expect(keys[1]).toEqual(keys[0]);
  });

  it("sin mensajes no llama a la base", async () => {
    const fake = fakeClient();
    await appendMessages(fake.client, "u", "c", []);
    expect(fake.calls).toHaveLength(0);
  });

  it("un id repetido no falla ni duplica, y el resto se guarda", async () => {
    const fake = fakeClient();
    await appendMessages(fake.client, "u", "c", [q1]);
    await appendMessages(fake.client, "u", "c", [q1, a1]);
    expect(fake.stored().map((r) => r.ui_id)).toEqual(["q1", "a1"]);
  });

  it("propaga el error de la base", async () => {
    const client = {
      from: () => ({
        upsert: async () => ({ error: { message: "boom" } }),
      }),
    } as unknown as Parameters<typeof appendMessages>[0];
    await expect(appendMessages(client, "u", "c", [q1])).rejects.toThrow(
      "db assistant_messages: boom",
    );
  });
});

describe("reintento después de una falla durante la respuesta", () => {
  // Lo que hace la ruta en un turno, con el modelo reemplazado por su resultado.
  async function turn(
    fake: ReturnType<typeof fakeClient>,
    question: UIMessage,
    answer: UIMessage | null,
  ): Promise<UIMessage[]> {
    const stored = fake.stored().map((r) => r.message);
    const history = historyWithQuestion(stored, question);
    const final = answer ? [...history, answer] : null;
    await appendMessages(
      fake.client,
      "u",
      "c",
      messagesToPersist(final, history, question),
    );
    return history;
  }

  it("la pregunta queda una vez, la respuesta se guarda una vez y en orden", async () => {
    const fake = fakeClient();
    await turn(fake, q1, a1);

    // Primer intento: el modelo falla en medio de la respuesta. Se guarda solo la pregunta.
    await turn(fake, q2, null);
    expect(fake.stored().map((r) => r.ui_id)).toEqual(["q1", "a1", "q2"]);

    // "Reintentar" reenvía la misma pregunta con el mismo id.
    const answer = text("msg-2", "assistant", "Bajó 2 %.");
    const history = await turn(
      fake,
      text("q2", "user", "¿Y el mes pasado?"),
      answer,
    );

    // Al modelo le llega la pregunta una sola vez, al final.
    expect(history.map((m) => m.id)).toEqual(["q1", "a1", "q2"]);
    // En la base: la pregunta una vez y después su respuesta.
    const rows = fake.stored();
    expect(rows.map((r) => r.ui_id)).toEqual(["q1", "a1", "q2", "msg-2"]);
    expect(rows.map((r) => r.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("un reintento que vuelve a fallar no duplica la pregunta", async () => {
    const fake = fakeClient();
    await turn(fake, q1, null);
    await turn(fake, q1, null);
    expect(fake.stored().map((r) => r.ui_id)).toEqual(["q1"]);
  });

  it("si la pregunta no llegó a guardarse (rechazo previo), se guarda con su respuesta", async () => {
    const fake = fakeClient();
    await turn(fake, q1, a1);
    expect(fake.stored().map((r) => r.ui_id)).toEqual(["q1", "a1"]);
  });
});
