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
import type { Json } from "@/lib/db/database.types";
import { listPortfolios } from "../queries";

// Varios portafolios contra finance-dev (`pnpm test:integration`): `create_portfolio`, el tope de 5,
// que no se pueda borrar el último, los nombres y `recent_imports` con su portafolio. Usuarios de
// prueba: se borran al terminar (y eso prueba que borrar a la persona no choca con "el último").

const LIMIT = "MP001";
const LAST = "MP002";

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

describe("varios portafolios (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser | undefined;

  const create = (user: TestUser, name: string) =>
    user.client.rpc("create_portfolio", { p_name: name });

  const portfolioRows = async (user: TestUser) =>
    must(
      await admin
        .from("portfolios")
        .select("id, name, user_id")
        .eq("user_id", user.id)
        .order("created_at"),
      "portafolios",
    );

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "pf-a");
    b = await createTestUser(admin, "pf-b");
  });

  afterAll(async () => {
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
    await deleteTestUser(admin, c);
  });

  it("create_portfolio crea el portafolio con su cuenta, del que llama, y listPortfolios los devuelve en orden", async () => {
    const id = must(await create(a, "  Cripto  "), "alta");

    const created = must(
      await admin
        .from("portfolios")
        .select("name, user_id, benchmark_symbol")
        .eq("id", id)
        .single(),
      "portafolio creado",
    );
    expect(created).toEqual({
      name: "Cripto",
      user_id: a.id,
      benchmark_symbol: "SPY",
    });
    const accounts = must(
      await admin
        .from("accounts")
        .select("user_id, currency, cost_method")
        .eq("portfolio_id", id),
      "cuenta creada",
    );
    expect(accounts).toEqual([
      { user_id: a.id, currency: "USD", cost_method: "AVERAGE" },
    ]);

    const listed = await listPortfolios(a.client);
    expect(listed.map((p) => p.name)).toEqual([
      "Portafolio principal",
      "Cripto",
    ]);
    expect(listed[1]!.id).toBe(id);
    expect(listed[1]!.account.id).not.toBe(listed[0]!.account.id);

    // B no ve los de A.
    expect((await listPortfolios(b.client)).map((p) => p.name)).toEqual([
      "Portafolio principal",
    ]);
  });

  it("create_portfolio con benchmark: el elegido queda guardado; uno con formato inválido, no", async () => {
    const id = must(
      await a.client.rpc("create_portfolio", {
        p_name: "Cripto con BTC",
        p_benchmark: "BTC-USD",
      }),
      "alta con benchmark",
    );
    expect(
      must(
        await admin
          .from("portfolios")
          .select("benchmark_symbol")
          .eq("id", id)
          .single(),
        "benchmark",
      ).benchmark_symbol,
    ).toBe("BTC-USD");
    const bad = await a.client.rpc("create_portfolio", {
      p_name: "Mal benchmark",
      p_benchmark: "btc usd",
    });
    expect(bad.error?.code).toBe(PG.checkViolation);
    // Se borra para que los que siguen cuenten igual.
    await a.client.from("portfolios").delete().eq("id", id);
  });

  it("instruments admite el tipo CRYPTO (y sigue rechazando uno inventado)", async () => {
    const symbol = `ZT${Math.random().toString(16).slice(2, 6).toUpperCase()}-USD`;
    const created = await admin
      .from("instruments")
      .insert({ symbol, name: "Moneda de prueba", type: "CRYPTO" })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    const invented = await admin
      .from("instruments")
      .insert({ symbol: `${symbol}X`, type: "BOND" });
    expect(invented.error?.code).toBe(PG.checkViolation);
    await admin.from("instruments").delete().eq("id", created.data!.id);
  });

  it("sin sesión no se puede crear", async () => {
    const { error } = await createAnon().rpc("create_portfolio", {
      p_name: "Anónimo",
    });
    expect(error).not.toBeNull();
  });

  it("los nombres: únicos por persona sin distinguir mayúsculas, sin bordes, hasta 40", async () => {
    const dup = await create(a, "CRIPTO");
    expect(dup.error?.code).toBe(PG.uniqueViolation);
    // Otra persona sí puede usar el mismo nombre.
    const other = await create(b, "Cripto");
    expect(other.error).toBeNull();

    expect((await create(a, "")).error?.code).toBe(PG.checkViolation);
    expect((await create(a, "   ")).error?.code).toBe(PG.checkViolation);
    expect((await create(a, "x".repeat(41))).error?.code).toBe(
      PG.checkViolation,
    );

    // Directo contra la tabla (RLS lo permite): los CHECK siguen valiendo.
    const untrimmed = await a.client
      .from("portfolios")
      .insert({ user_id: a.id, name: " Suelto " });
    expect(untrimmed.error?.code).toBe(PG.checkViolation);

    // Renombrar a uno que ya existe tampoco.
    const [, cripto] = await portfolioRows(a);
    const rename = await a.client
      .from("portfolios")
      .update({ name: "portafolio PRINCIPAL" })
      .eq("id", cripto!.id);
    expect(rename.error?.code).toBe(PG.uniqueViolation);
  });

  it("hasta 5 por persona, también con altas simultáneas", async () => {
    c = await createTestUser(admin, "pf-c");
    // Tiene 1; se piden 6 a la vez: entran exactamente 4.
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => create(c!, `Paralelo ${i}`)),
    );
    const failed = results.filter((r) => r.error !== null);
    expect(results.filter((r) => r.error === null)).toHaveLength(4);
    expect(failed.map((r) => r.error?.code)).toEqual([LIMIT, LIMIT]);
    expect(await portfolioRows(c)).toHaveLength(5);

    // Con la tabla directa, igual.
    const direct = await c.client
      .from("portfolios")
      .insert({ user_id: c.id, name: "Sexto" });
    expect(direct.error?.code).toBe(LIMIT);
    // El tope es por persona: A sigue pudiendo crear.
    expect((await create(a, "Retiro")).error).toBeNull();
  });

  it("no se puede borrar el último; sí los demás, con sus cuentas y operaciones", async () => {
    const rows = await portfolioRows(b);
    expect(rows).toHaveLength(2);
    const [main, extra] = rows;
    const extraAccount = must(
      await admin
        .from("accounts")
        .select("id")
        .eq("portfolio_id", extra!.id)
        .single(),
      "cuenta del extra",
    ).id;
    must(
      await b.client
        .from("transactions")
        .insert({
          user_id: b.id,
          account_id: extraAccount,
          type: "DEPOSIT",
          executed_at: "2026-03-06T15:00:00Z",
          amount: 10,
        })
        .select("id"),
      "depósito en el extra",
    );

    const deleted = await b.client
      .from("portfolios")
      .delete()
      .eq("id", extra!.id)
      .select("id");
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);
    const left = must(
      await admin.from("transactions").select("id").eq("user_id", b.id),
      "operaciones de B",
    );
    expect(left).toEqual([]);

    const last = await b.client.from("portfolios").delete().eq("id", main!.id);
    expect(last.error?.code).toBe(LAST);
    expect(await portfolioRows(b)).toHaveLength(1);

    // Borrar todos de una vez tampoco: el último frena la sentencia entera.
    const all = await a.client.from("portfolios").delete().eq("user_id", a.id);
    expect(all.error?.code).toBe(LAST);
    expect(await portfolioRows(a)).toHaveLength(3);
  });

  it("A no puede borrar ni renombrar los de B (RLS: no los ve)", async () => {
    const [bMain] = await portfolioRows(b);
    const del = await a.client
      .from("portfolios")
      .delete()
      .eq("id", bMain!.id)
      .select("id");
    expect(del.error).toBeNull();
    expect(del.data).toEqual([]);
    const upd = await a.client
      .from("portfolios")
      .update({ name: "Hackeado" })
      .eq("id", bMain!.id)
      .select("id");
    expect(upd.data).toEqual([]);
    expect((await portfolioRows(b))[0]!.name).toBe("Portafolio principal");
  });

  it("recent_imports dice el portafolio de cada importación (y null si se borró)", async () => {
    const listed = await listPortfolios(a.client);
    const target = listed.find((p) => p.name === "Retiro")!;
    const imported = must(
      await a.client.rpc("import_transactions", {
        p_account_id: target.account.id,
        p_source: "csv",
        p_filename: "retiro.csv",
        p_rows: [
          {
            type: "DEPOSIT",
            symbol: null,
            executed_at: "2026-03-06T15:00:00.000Z",
            amount: "5",
            currency: "USD",
            notes: null,
            external_id: "csv:retiro:1",
          },
        ] as unknown as Json,
        p_report: {} as Json,
      }),
      "importación",
    );
    const importId = imported[0]!.import_id;

    const find = async () =>
      must(await a.client.rpc("recent_imports", { p_limit: 10 }), "lista").find(
        (row) => row.import_id === importId,
      );
    expect((await find())?.portfolio_id).toBe(target.id);

    const gone = await a.client.from("portfolios").delete().eq("id", target.id);
    expect(gone.error).toBeNull();
    const after = await find();
    expect(after?.portfolio_id).toBeNull();
    expect(after?.live_count).toBe(0);
  });
});
