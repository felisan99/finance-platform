import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PG,
  createAdmin,
  createAnon,
  createTestUser,
  deleteTestUser,
  type DbClient,
  type TestUser,
} from "@/lib/db/__tests__/integration-helpers";
import {
  appendMessages,
  createConversation,
  getConversation,
  getOrCreateActiveConversation,
  loadMessages,
  saveRun,
  saveSummary,
} from "../conversation-store";
import { MemoryLimitError } from "../memory";
import { supabaseMemoryStore } from "../memory-store";
import { summarizeRun } from "../telemetry";

// Tablas del asistente contra finance-dev (`pnpm test:integration`): RLS entre dos personas, el
// tope de la memoria, el límite de uso y las mismas funciones que usa la ruta. Sin modelo de IA.

describe("asistente: tablas y RLS (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "assistant-a");
    b = await createTestUser(admin, "assistant-b");
  });

  afterAll(async () => {
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
  });

  it("conversación y mensajes: cada uno ve solo lo suyo", async () => {
    const conversation = await getOrCreateActiveConversation(a.client, a.id);
    expect(await getOrCreateActiveConversation(a.client, a.id)).toEqual(
      conversation,
    );
    await appendMessages(a.client, a.id, conversation.id, [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Hola" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "¡Hola!" }],
      },
    ]);
    const mine = await loadMessages(a.client, conversation);
    expect(mine.map((m) => m.message.id)).toEqual(["u1", "a1"]);

    // B no la ve, ni sus mensajes, ni puede escribir en ella.
    expect(await getConversation(b.client, conversation.id)).toBeNull();
    expect(await loadMessages(b.client, conversation)).toEqual([]);
    const intrusion = await b.client.from("assistant_messages").insert({
      ui_id: "x1",
      conversation_id: conversation.id,
      user_id: b.id,
      role: "user",
      message: { id: "x1", role: "user", parts: [] },
    });
    expect(intrusion.error?.code).toBe(PG.foreignKeyViolation);
    const asA = await b.client.from("assistant_messages").insert({
      ui_id: "x2",
      conversation_id: conversation.id,
      user_id: a.id,
      role: "user",
      message: { id: "x2", role: "user", parts: [] },
    });
    expect(asA.error?.code).toBe(PG.insufficientPrivilege);
  });

  it("el resumen oculta los mensajes ya resumidos", async () => {
    const conversation = await createConversation(a.client, a.id);
    await appendMessages(a.client, a.id, conversation.id, [
      { id: "u1", role: "user", parts: [{ type: "text", text: "1" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "2" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "3" }] },
    ]);
    const [first, second] = await loadMessages(a.client, conversation);
    await saveSummary(a.client, conversation.id, "- Resumen", second!.seq);
    const updated = (await getConversation(a.client, conversation.id))!;
    expect(updated.summary).toBe("- Resumen");
    expect(updated.summarizedThrough).toBe(second!.seq);
    expect(
      (await loadMessages(a.client, updated)).map((m) => m.message.id),
    ).toEqual(["u2"]);
    expect(first!.seq).toBeLessThan(second!.seq);
  });

  it("guardar dos veces el mismo mensaje no falla ni lo duplica (reintento)", async () => {
    const conversation = await createConversation(a.client, a.id);
    const question = {
      id: "q1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "¿Cómo voy?" }],
    };
    await appendMessages(a.client, a.id, conversation.id, [question]);
    await appendMessages(a.client, a.id, conversation.id, [
      question,
      {
        id: "r1",
        role: "assistant",
        parts: [{ type: "text", text: "Bien." }],
      },
    ]);
    const stored = await loadMessages(a.client, conversation);
    expect(stored.map((m) => m.message.id)).toEqual(["q1", "r1"]);

    // B no escribe nada en la conversación de A. Con un id nuevo la FK lo rechaza; con un id que ya
    // existe el insert no hace nada (ON CONFLICT DO NOTHING) y tampoco agrega ni cambia filas.
    await expect(
      appendMessages(b.client, b.id, conversation.id, [
        { id: "intruso", role: "user", parts: [] },
      ]),
    ).rejects.toThrow();
    await appendMessages(b.client, b.id, conversation.id, [question]);
    const after = await loadMessages(a.client, conversation);
    expect(after.map((m) => m.message.id)).toEqual(["q1", "r1"]);
    expect(after.every((m) => m.message.parts.length > 0)).toBe(true);
  });

  it("un mensaje no se puede editar (solo agregar o borrar)", async () => {
    const { error } = await a.client
      .from("assistant_messages")
      .update({ role: "assistant" })
      .eq("ui_id", "u1");
    expect(error?.code).toBe(PG.insufficientPrivilege);
  });

  it("memoria: propia, sin la de otros, y con tope de 30", async () => {
    const store = supabaseMemoryStore(a.client, a.id);
    const item = await store.add("goal", "Jubilarse temprano");
    expect(await supabaseMemoryStore(b.client, b.id).list()).toEqual([]);
    expect(await supabaseMemoryStore(b.client, b.id).remove(item.id)).toBe(
      false,
    );
    expect((await store.update(item.id, "Jubilarse a los 60"))?.content).toBe(
      "Jubilarse a los 60",
    );

    for (let i = 1; i < 30; i++) await store.add("fact", `Dato ${i}`);
    await expect(store.add("fact", "Uno más")).rejects.toBeInstanceOf(
      MemoryLimitError,
    );
    expect(await store.list()).toHaveLength(30);
  });

  it("la base rechaza un recuerdo vacío o demasiado largo", async () => {
    for (const content of ["", "x".repeat(301), " con espacios "]) {
      const { error } = await b.client
        .from("assistant_memory")
        .insert({ user_id: b.id, kind: "fact", content });
      expect(error?.code, JSON.stringify(content)).toBe(PG.checkViolation);
    }
  });

  it("métricas: se insertan y se leen solo las propias, y no se editan", async () => {
    const conversation = await getOrCreateActiveConversation(a.client, a.id);
    await saveRun(
      a.client,
      a.id,
      conversation.id,
      summarizeRun({
        event: null,
        requestedModel: "a/b:free",
        timings: [{ name: "get_positions", ok: true, ms: 4 }],
        latencyMs: 100,
        errorCode: null,
      }),
    );
    const own = await a.client.from("assistant_runs").select("tools, model");
    expect(own.data).toEqual([
      {
        tools: [{ name: "get_positions", ok: true, ms: 4 }],
        model: "a/b:free",
      },
    ]);
    expect((await b.client.from("assistant_runs").select("id")).data).toEqual(
      [],
    );
    const edit = await a.client
      .from("assistant_runs")
      .update({ steps: 99 })
      .eq("user_id", a.id);
    expect(edit.error?.code).toBe(PG.insufficientPrivilege);
  });

  it("anon no ve nada", async () => {
    const anon = createAnon();
    for (const table of [
      "assistant_conversations",
      "assistant_messages",
      "assistant_memory",
      "assistant_runs",
    ] as const) {
      const { error } = await anon.from(table).select("*").limit(1);
      expect(error?.code, table).toBe(PG.insufficientPrivilege);
    }
  });

  it("límites: 8 preguntas cada 5 minutos y claves nuevas reconocidas", async () => {
    let allowed = 0;
    for (let i = 0; i < 9; i++) {
      const { data } = await b.client.rpc("take_rate_limit", {
        p_key: "assistant_message",
      });
      if (data === true) allowed++;
    }
    expect(allowed).toBe(8);
    for (const key of ["assistant_daily", "news_search"]) {
      const { data, error } = await b.client.rpc("take_rate_limit", {
        p_key: key,
      });
      expect(error, key).toBeNull();
      expect(data, key).toBe(true);
    }
    // Las claves de antes siguen andando.
    const { error } = await b.client.rpc("take_rate_limit", {
      p_key: "search_symbols",
    });
    expect(error).toBeNull();
  });
});
