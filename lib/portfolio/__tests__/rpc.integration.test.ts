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
import { ensureInstruments } from "@/lib/market-jobs/instruments";
import { parseDeltaCsv } from "@/lib/importers";
import { draftsToRpcRows } from "../mappers";
import { loadPortfolioSnapshot } from "../queries";
import { FIXTURE_CSV } from "./fixture";

// Las funciones SQL de la Fase 4 contra finance-dev (`pnpm test:integration`): importación atómica,
// límites de uso y precios por instrumento; y la aceptación de la sección 8.3 leyendo con las
// mismas consultas que usa la interfaz. Usuarios e instrumentos de prueba: se borran al terminar.

const loose = (client: DbClient) =>
  client as unknown as import("@supabase/supabase-js").SupabaseClient;

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

describe("RPCs de la Fase 4 (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;
  let accountA: string;
  let accountB: string;
  let symbol: string;
  let instrumentId: string;
  const instrumentIds: string[] = [];

  const accountOf = async (user: TestUser) =>
    must(
      await admin.from("accounts").select("id").eq("user_id", user.id).single(),
      "cuenta",
    ).id;

  const importRows = (
    user: TestUser,
    account: string,
    rows: unknown[],
    filename = "prueba.csv",
    source = "delta_csv",
  ) =>
    user.client.rpc("import_transactions", {
      p_account_id: account,
      p_source: source,
      p_filename: filename,
      p_rows: rows as Json,
      p_report: { prueba: true } as Json,
    });

  const sample = () => [
    {
      type: "DEPOSIT",
      symbol: null,
      executed_at: "2026-03-06T22:30:00.000Z",
      amount: "4200",
      currency: "USD",
      notes: "Comision 30USD",
      external_id: `t:${symbol}:1`,
    },
    {
      type: "BUY",
      symbol,
      executed_at: "2026-03-09T22:34:00.000Z",
      quantity: "1.5",
      price: "600.12345678",
      fee: "1",
      currency: "USD",
      external_id: `t:${symbol}:2`,
    },
    {
      type: "DIVIDEND",
      symbol,
      executed_at: "2026-03-27T13:30:00.000Z",
      amount: "2.5",
      currency: "USD",
      external_id: `t:${symbol}:3`,
    },
  ];

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "rpc-a");
    b = await createTestUser(admin, "rpc-b");
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
    instrumentIds.push(instrumentId);
  });

  afterAll(async () => {
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
    if (instrumentIds.length > 0)
      await admin.from("instruments").delete().in("id", instrumentIds);
  });

  describe("import_transactions", () => {
    it("importa en orden, con los decimales exactos, y registra la importación", async () => {
      const { data, error } = await importRows(a, accountA, sample());
      expect(error).toBeNull();
      expect(data?.[0]).toMatchObject({ inserted: 3, duplicates: 0 });

      const rows = must(
        await loose(a.client)
          .from("transactions")
          .select(
            "type, instrument_id, quantity::text, price::text, amount::text, fee::text, source, external_id, seq",
          )
          .eq("account_id", accountA)
          .like("external_id", `t:${symbol}:%`)
          .order("seq"),
        "transacciones",
      ) as Array<Record<string, string | number | null>>;
      expect(rows.map((r) => r.type)).toEqual(["DEPOSIT", "BUY", "DIVIDEND"]);
      expect(rows[1]).toMatchObject({
        quantity: "1.50000000",
        price: "600.12345678",
        fee: "1.0000",
        instrument_id: instrumentId,
        source: "delta_csv",
      });
      expect(rows[0]).toMatchObject({
        amount: "4200.0000",
        instrument_id: null,
      });

      const imports = must(
        await loose(a.client)
          .from("imports")
          .select(
            "source, filename, rows_total, rows_imported, rows_skipped, report",
          )
          .eq("id", data![0]!.import_id),
        "import",
      ) as Array<Record<string, unknown>>;
      expect(imports[0]).toMatchObject({
        source: "delta_csv",
        filename: "prueba.csv",
        rows_total: 3,
        rows_imported: 3,
        rows_skipped: 0,
        report: { prueba: true },
      });
    });

    it("reimportar lo mismo: todo duplicado, no se agrega nada", async () => {
      const { data, error } = await importRows(a, accountA, sample());
      expect(error).toBeNull();
      expect(data?.[0]).toMatchObject({ inserted: 0, duplicates: 3 });
      const count = must(
        await loose(a.client)
          .from("transactions")
          .select("id")
          .eq("account_id", accountA)
          .like("external_id", `t:${symbol}:%`),
        "transacciones",
      ) as unknown[];
      expect(count).toHaveLength(3);
    });

    it("atomicidad: una fila válida más una inválida no dejan nada (ni el registro de importación)", async () => {
      const importsBefore = must(
        await loose(a.client)
          .from("imports")
          .select("id")
          .eq("filename", "malo.csv"),
        "imports",
      ) as unknown[];
      const { error } = await importRows(
        a,
        accountA,
        [
          {
            type: "DEPOSIT",
            symbol: null,
            executed_at: "2026-04-01T00:00:00Z",
            amount: "5",
            external_id: `t:${symbol}:9`,
          },
          {
            type: "BUY",
            symbol,
            executed_at: "2026-04-02T00:00:00Z",
            quantity: "1",
            external_id: `t:${symbol}:10`,
          }, // sin precio: viola el CHECK
        ],
        "malo.csv",
      );
      expect(error?.code).toBe(PG.checkViolation);
      const left = must(
        await loose(a.client)
          .from("transactions")
          .select("id")
          .eq("external_id", `t:${symbol}:9`),
        "restos",
      ) as unknown[];
      expect(left).toHaveLength(0);
      const importsAfter = must(
        await loose(a.client)
          .from("imports")
          .select("id")
          .eq("filename", "malo.csv"),
        "imports",
      ) as unknown[];
      expect(importsAfter).toHaveLength(importsBefore.length);
    });

    it("una compra de un símbolo que no existe en instruments se rechaza y no deja nada", async () => {
      const { error } = await importRows(a, accountA, [
        {
          type: "BUY",
          symbol: "ZTNOEXISTE",
          executed_at: "2026-04-02T00:00:00Z",
          quantity: "1",
          price: "10",
          external_id: `t:${symbol}:11`,
        },
      ]);
      expect(error?.code).toBe(PG.checkViolation);
    });

    it("el usuario B no puede importar a la cuenta de A (42501); sin sesión, tampoco", async () => {
      const cross = await importRows(b, accountA, sample());
      expect(cross.error?.code).toBe(PG.insufficientPrivilege);
      const anon = await createAnon().rpc("import_transactions", {
        p_account_id: accountA,
        p_source: "delta_csv",
        p_filename: "x.csv",
        p_rows: sample() as Json,
        p_report: {} as Json,
      });
      expect(anon.error?.code).toBe(PG.insufficientPrivilege);
      // Y B sigue sin ver nada de A.
      const seen = must(
        await loose(b.client)
          .from("transactions")
          .select("id")
          .eq("account_id", accountA),
        "lectura de B",
      ) as unknown[];
      expect(seen).toHaveLength(0);
    });

    it("cada usuario puede importar lo mismo en su propia cuenta (la dedupe es por cuenta)", async () => {
      const { data, error } = await importRows(b, accountB, sample());
      expect(error).toBeNull();
      expect(data?.[0]).toMatchObject({ inserted: 3, duplicates: 0 });
    });

    it("valida la entrada: origen, arreglo vacío, no arreglo y más de 5000 filas", async () => {
      expect(
        (await importRows(a, accountA, sample(), "x.csv", "otro")).error?.code,
      ).toBe("22023");
      expect((await importRows(a, accountA, [])).error?.code).toBe("22023");
      const notArray = await a.client.rpc("import_transactions", {
        p_account_id: accountA,
        p_source: "delta_csv",
        p_filename: "x",
        p_rows: { a: 1 } as Json,
        p_report: {} as Json,
      });
      expect(notArray.error?.code).toBe("22023");
      const tooMany = Array.from({ length: 5001 }, (_, i) => ({
        type: "DEPOSIT",
        symbol: null,
        executed_at: "2026-04-01T00:00:00Z",
        amount: "1",
        external_id: `t:${symbol}:big${i}`,
      }));
      expect((await importRows(a, accountA, tooMany)).error?.code).toBe(
        "22023",
      );
    });
  });

  describe("take_rate_limit", () => {
    it("refresh_quotes: 1 cada 5 minutos, la segunda llamada se rechaza", async () => {
      expect(
        (await a.client.rpc("take_rate_limit", { p_key: "refresh_quotes" }))
          .data,
      ).toBe(true);
      expect(
        (await a.client.rpc("take_rate_limit", { p_key: "refresh_quotes" }))
          .data,
      ).toBe(false);
    });

    it("el uso de un usuario no limita a otro", async () => {
      expect(
        (await b.client.rpc("take_rate_limit", { p_key: "refresh_quotes" }))
          .data,
      ).toBe(true);
    });

    it("search_symbols: 30 por minuto; la 31 se rechaza", async () => {
      let allowed = 0;
      for (let i = 0; i < 30; i++) {
        if (
          (await a.client.rpc("take_rate_limit", { p_key: "search_symbols" }))
            .data === true
        )
          allowed++;
      }
      expect(allowed).toBe(30);
      expect(
        (await a.client.rpc("take_rate_limit", { p_key: "search_symbols" }))
          .data,
      ).toBe(false);
    });

    it("la persona no puede elegir el límite ni la ventana (la firma vieja ya no existe) ni usar claves inventadas", async () => {
      const old = await loose(a.client).rpc("take_rate_limit", {
        p_key: "search_symbols",
        p_limit: 1000,
        p_window_seconds: 1,
      });
      expect(old.error).not.toBeNull();
      // Sigue bloqueado: intentar reiniciar el contador no sirvió.
      expect(
        (await a.client.rpc("take_rate_limit", { p_key: "search_symbols" }))
          .data,
      ).toBe(false);
      expect(
        (await a.client.rpc("take_rate_limit", { p_key: "inventada" })).error
          ?.code,
      ).toBe("22023");
    });

    it("sin sesión (anon) no se puede llamar", async () => {
      expect(
        (await createAnon().rpc("take_rate_limit", { p_key: "refresh_quotes" }))
          .error?.code,
      ).toBe(PG.insufficientPrivilege);
    });

    it("la tabla rate_limits no es accesible para los usuarios (ni leer, ni escribir)", async () => {
      expect(
        (await loose(a.client).from("rate_limits").select("*")).error?.code,
      ).toBe(PG.insufficientPrivilege);
      expect(
        (
          await loose(a.client)
            .from("rate_limits")
            .insert({ user_id: a.id, key: "x" })
        ).error?.code,
      ).toBe(PG.insufficientPrivilege);
      expect(
        (
          await loose(a.client)
            .from("rate_limits")
            .update({ count: 0 })
            .eq("user_id", a.id)
        ).error?.code,
      ).toBe(PG.insufficientPrivilege);
      expect(
        (await loose(a.client).from("rate_limits").delete().eq("user_id", a.id))
          .error?.code,
      ).toBe(PG.insufficientPrivilege);
    });

    it("al vencer la ventana el contador se reinicia", async () => {
      await admin
        .from("rate_limits")
        .update({ window_start: new Date(Date.now() - 301_000).toISOString() })
        .eq("user_id", a.id)
        .eq("key", "refresh_quotes");
      expect(
        (await a.client.rpc("take_rate_limit", { p_key: "refresh_quotes" }))
          .data,
      ).toBe(true);
    });
  });

  describe("instrument_prices", () => {
    it("devuelve el último y el penúltimo cierre en texto, y nada para un instrumento sin precios", async () => {
      const withPrices = must(
        await admin
          .from("instruments")
          .insert({
            symbol: randomSymbol(),
            name: "Con precios",
            type: "STOCK",
          })
          .select("id")
          .single(),
        "instrumento",
      ).id;
      const without = must(
        await admin
          .from("instruments")
          .insert({
            symbol: randomSymbol(),
            name: "Sin precios",
            type: "STOCK",
          })
          .select("id")
          .single(),
        "instrumento",
      ).id;
      instrumentIds.push(withPrices, without);
      must(
        await admin
          .from("prices_daily")
          .insert([
            { instrument_id: withPrices, date: "2026-09-21", close: 712.78 },
            { instrument_id: withPrices, date: "2026-09-22", close: 700.5 },
            { instrument_id: withPrices, date: "2026-09-23", close: 707.6 },
          ])
          .select("date"),
        "precios",
      );

      const { data, error } = await a.client.rpc("instrument_prices", {
        p_instrument_ids: [withPrices, without],
      });
      expect(error).toBeNull();
      expect(data).toEqual([
        {
          instrument_id: withPrices,
          last_close: "707.600000",
          last_date: "2026-09-23",
          prev_close: "700.500000",
          prev_date: "2026-09-22",
        },
      ]);
    });

    it("máximo 500 instrumentos y sin sesión no se puede llamar", async () => {
      const ids = Array.from({ length: 501 }, () => crypto.randomUUID());
      expect(
        (await a.client.rpc("instrument_prices", { p_instrument_ids: ids }))
          .error?.code,
      ).toBe("22023");
      expect(
        (
          await createAnon().rpc("instrument_prices", {
            p_instrument_ids: [instrumentId],
          })
        ).error?.code,
      ).toBe(PG.insufficientPrivilege);
    });
  });

  describe("aceptación de la sección 8.3 a través de la base", () => {
    it("importar el CSV de Delta y leer con las consultas de la interfaz da los números esperados", async () => {
      const parsed = parseDeltaCsv(FIXTURE_CSV);
      const fresh = await createTestUser(admin, "rpc-acc");
      try {
        // Los símbolos del fixture ya existen en finance-dev (los dejó el cron diario); si no, se crean.
        await ensureInstruments(admin, parsed.instruments);
        const account = await accountOf(fresh);
        const { data, error } = await fresh.client.rpc("import_transactions", {
          p_account_id: account,
          p_source: "delta_csv",
          p_filename: "delta_export.csv",
          p_rows: draftsToRpcRows(parsed.transactions) as unknown as Json,
          p_report: {} as Json,
        });
        expect(error).toBeNull();
        expect(data?.[0]?.inserted).toBe(parsed.transactions.length);

        const snapshot = await loadPortfolioSnapshot(fresh.client);
        expect(snapshot).not.toBeNull();
        expect(snapshot!.engine.cash.toFixed()).toBe("882.745");
        expect(snapshot!.engine.totals.openCostBasis.toFixed()).toBe(
          "8664.27",
        );
        expect(snapshot!.engine.totals.realizedPnl.toFixed()).toBe("247.015");
        const cost = (s: string) =>
          snapshot!.engine.positions
            .find((p) => p.symbol === s)
            ?.costBasis.toFixed();
        expect(cost("VOO")).toBe("5724.77");
        expect(cost("SOXX")).toBe("2069.5");
        expect(cost("FSLY")).toBe("346.8");
        expect(cost("ILF")).toBe("331.6");
        expect(cost("NFLX")).toBe("191.6");
        expect(
          snapshot!.engine.issues.filter((i) => i.severity === "error"),
        ).toEqual([]);
      } finally {
        await deleteTestUser(admin, fresh);
      }
    });
  });
});
