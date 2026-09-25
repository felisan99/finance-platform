import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PG,
  createAdmin,
  createAnon,
  createTestUser,
  deleteTestUser,
  randomSymbol,
  type DbClient,
  type TestUser,
} from "@/lib/db/__tests__/integration-helpers";
import type { Json } from "@/lib/db/database.types";

// «Deshacer importación» y el origen `csv` contra finance-dev (`pnpm test:integration`): cada
// transacción importada queda ligada a su importación, deshacer borra solo lo de esa importación y
// solo el dueño puede hacerlo. Usuarios e instrumentos de prueba: se borran al terminar.

function must<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
  what: string,
): NonNullable<R["data"]> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(
      `Preparación: ${what}: ${result.error?.message ?? "sin datos"}`,
    );
  }
  return result.data as NonNullable<R["data"]>;
}

describe("deshacer importación (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;
  let accountA: string;
  let accountB: string;
  let symbol: string;
  let instrumentId: string;

  const accountOf = async (user: TestUser) =>
    must(
      await admin.from("accounts").select("id").eq("user_id", user.id).single(),
      "cuenta",
    ).id;

  const rows = (tag: string) => [
    {
      type: "DEPOSIT",
      symbol: null,
      executed_at: "2026-03-06T15:00:00.000Z",
      amount: "1000",
      currency: "USD",
      notes: null,
      external_id: `csv:${tag}:1`,
    },
    {
      type: "BUY",
      symbol,
      executed_at: "2026-03-09T15:00:00.000Z",
      quantity: "2",
      price: "400.5",
      fee: "1",
      currency: "USD",
      notes: null,
      external_id: `csv:${tag}:2`,
    },
    {
      type: "DIVIDEND",
      symbol,
      executed_at: "2026-03-27T15:00:00.000Z",
      amount: "1.15",
      currency: "USD",
      notes: null,
      external_id: `csv:${tag}:3`,
    },
  ];

  const importAs = (
    user: TestUser,
    account: string,
    tag: string,
    source = "csv",
  ) =>
    user.client.rpc("import_transactions", {
      p_account_id: account,
      p_source: source,
      p_filename: `${tag}.csv`,
      p_rows: rows(tag) as unknown as Json,
      p_report: { prueba: true } as Json,
    });

  const linked = async (user: TestUser, importId: string) =>
    must(
      await user.client
        .from("transactions")
        .select("id, type, source, import_id")
        .eq("import_id", importId),
      "transacciones ligadas",
    );

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "undo-a");
    b = await createTestUser(admin, "undo-b");
    accountA = await accountOf(a);
    accountB = await accountOf(b);
    symbol = randomSymbol();
    instrumentId = must(
      await admin
        .from("instruments")
        .insert({ symbol, name: "Instrumento de prueba", type: "ETF" })
        .select("id")
        .single(),
      "instrumento",
    ).id;
  });

  afterAll(async () => {
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
    await admin.from("instruments").delete().eq("id", instrumentId);
  });

  it("el origen csv se acepta y cada transacción queda ligada a su importación", async () => {
    const { data, error } = await importAs(a, accountA, "ligada");
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ inserted: 3, duplicates: 0 });
    const importId = data![0]!.import_id;

    const txs = await linked(a, importId);
    expect(txs).toHaveLength(3);
    expect(txs.every((tx) => tx.source === "csv")).toBe(true);

    const [imp] = must(
      await a.client
        .from("imports")
        .select("source, filename, undone_at")
        .eq("id", importId),
      "importación",
    );
    expect(imp).toMatchObject({
      source: "csv",
      filename: "ligada.csv",
      undone_at: null,
    });
  });

  it("un origen desconocido se sigue rechazando", async () => {
    const { error } = await importAs(a, accountA, "raro", "excel");
    expect(error?.message).toMatch(/origen de importación inválido/);
  });

  it("recent_imports lista las propias con cuántas transacciones quedan; el otro usuario no las ve", async () => {
    const { data: imported } = await importAs(a, accountA, "listada");
    const importId = imported![0]!.import_id;

    const { data, error } = await a.client.rpc("recent_imports", {
      p_limit: 10,
    });
    expect(error).toBeNull();
    const mine = data!.find((row) => row.import_id === importId);
    expect(mine).toMatchObject({
      source: "csv",
      filename: "listada.csv",
      rows_imported: 3,
      undone_at: null,
      live_count: 3,
    });

    const theirs = await b.client.rpc("recent_imports", { p_limit: 50 });
    expect(theirs.error).toBeNull();
    expect(theirs.data!.some((row) => row.import_id === importId)).toBe(false);
  });

  it("recent_imports valida el límite y no la ejecuta anon", async () => {
    for (const p_limit of [0, 51]) {
      const { error } = await a.client.rpc("recent_imports", { p_limit });
      expect(error?.message).toMatch(/p_limit inválido/);
    }
    const anon = await createAnon().rpc("recent_imports", { p_limit: 5 });
    expect(anon.error?.code).toBe(PG.insufficientPrivilege);
  });

  it("deshacer borra solo lo de esa importación (no lo cargado a mano ni otra importación) y la marca", async () => {
    const first = await importAs(a, accountA, "deshacer-1");
    const second = await importAs(a, accountA, "deshacer-2");
    const firstId = first.data![0]!.import_id;
    const secondId = second.data![0]!.import_id;

    const manual = must(
      await a.client
        .from("transactions")
        .insert({
          user_id: a.id,
          account_id: accountA,
          type: "DEPOSIT",
          executed_at: "2026-04-01T15:00:00Z",
          amount: 50,
          source: "manual",
        })
        .select("id")
        .single(),
      "operación manual",
    );

    const undone = await a.client.rpc("undo_import", { p_import_id: firstId });
    expect(undone.error).toBeNull();
    expect(undone.data).toBe(3);

    expect(await linked(a, firstId)).toHaveLength(0);
    expect(await linked(a, secondId)).toHaveLength(3);
    const stillThere = must(
      await a.client.from("transactions").select("id").eq("id", manual.id),
      "manual",
    );
    expect(stillThere).toHaveLength(1);

    const { data } = await a.client.rpc("recent_imports", { p_limit: 50 });
    const row = data!.find((r) => r.import_id === firstId);
    expect(row?.live_count).toBe(0);
    expect(row?.undone_at).not.toBeNull();
  });

  it("deshacer dos veces la misma importación: la segunda falla y no borra nada más", async () => {
    const { data } = await importAs(a, accountA, "doble");
    const importId = data![0]!.import_id;
    expect(
      (await a.client.rpc("undo_import", { p_import_id: importId })).data,
    ).toBe(3);

    const again = await a.client.rpc("undo_import", { p_import_id: importId });
    expect(again.error?.message).toMatch(/inexistente o ya deshecha/);
  });

  it("después de deshacer, el mismo archivo se puede volver a importar", async () => {
    const { data } = await importAs(a, accountA, "reimportar");
    await a.client.rpc("undo_import", { p_import_id: data![0]!.import_id });

    const again = await importAs(a, accountA, "reimportar");
    expect(again.error).toBeNull();
    expect(again.data?.[0]).toMatchObject({ inserted: 3, duplicates: 0 });
  });

  it("el usuario B no puede deshacer la importación de A (y no se borra nada)", async () => {
    const { data } = await importAs(a, accountA, "ajena");
    const importId = data![0]!.import_id;

    const attempt = await b.client.rpc("undo_import", {
      p_import_id: importId,
    });
    expect(attempt.error?.message).toMatch(/inexistente o ya deshecha/);
    expect(await linked(a, importId)).toHaveLength(3);
  });

  it("sin sesión (anon) no puede ejecutar undo_import", async () => {
    const { data } = await importAs(a, accountA, "anon");
    const anon = await createAnon().rpc("undo_import", {
      p_import_id: data![0]!.import_id,
    });
    expect(anon.error?.code).toBe(PG.insufficientPrivilege);
  });

  it("un id inexistente o nulo se rechaza", async () => {
    const missing = await a.client.rpc("undo_import", {
      p_import_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(missing.error?.message).toMatch(/inexistente o ya deshecha/);
  });

  it("B no puede colgar una transacción propia de la importación de A (FK compuesta)", async () => {
    const { data } = await importAs(a, accountA, "fk");
    const importId = data![0]!.import_id;

    const own = must(
      await b.client
        .from("transactions")
        .insert({
          user_id: b.id,
          account_id: accountB,
          type: "DEPOSIT",
          executed_at: "2026-04-02T15:00:00Z",
          amount: 10,
          source: "manual",
        })
        .select("id")
        .single(),
      "operación de B",
    );
    const attempt = await b.client
      .from("transactions")
      .update({ import_id: importId })
      .eq("id", own.id);
    expect(attempt.error?.code).toBe(PG.foreignKeyViolation);
    // Y lo de A sigue intacto.
    expect(await linked(a, importId)).toHaveLength(3);
  });

  it("borrar el registro de una importación deja las transacciones (import_id pasa a nulo)", async () => {
    const { data } = await importAs(a, accountA, "registro");
    const importId = data![0]!.import_id;
    const before = await linked(a, importId);
    expect(before).toHaveLength(3);

    const del = await a.client.from("imports").delete().eq("id", importId);
    expect(del.error).toBeNull();

    const remaining = must(
      await a.client
        .from("transactions")
        .select("id, import_id")
        .in(
          "id",
          before.map((tx) => tx.id),
        ),
      "transacciones",
    );
    expect(remaining).toHaveLength(3);
    expect(remaining.every((tx) => tx.import_id === null)).toBe(true);
  });
});
