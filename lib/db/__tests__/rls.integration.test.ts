import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../database.types";
import {
  PG,
  createAdmin,
  createAnon,
  createTestUser,
  deleteTestUser,
  randomSymbol,
  type DbClient,
  type TestUser,
} from "./integration-helpers";

// Aislamiento entre usuarios (criterio de terminado de la Fase 2): el usuario A no puede leer,
// modificar ni colgar datos del usuario B. Corre contra finance-dev (ver assertDevProject).

type TxInsert = Database["public"]["Tables"]["transactions"]["Insert"];

const USER_TABLES = [
  "profiles",
  "portfolios",
  "accounts",
  "transactions",
  "watchlists",
  "watchlist_items",
  "imports",
] as const;
const MARKET_TABLES = [
  "instruments",
  "prices_daily",
  "quotes_latest",
  "corporate_actions",
] as const;
const ALL_TABLES = [
  ...USER_TABLES,
  ...MARKET_TABLES,
  "allowed_emails",
] as const;

/** Para recorrer tablas por nombre sin pelear con los tipos por tabla del cliente. */
const loose = (client: DbClient) => client as unknown as SupabaseClient;

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

function ok(result: { error: { message: string } | null }, what: string): void {
  if (result.error) {
    throw new Error(`Preparación: ${what}: ${result.error.message}`);
  }
}

describe("RLS: aislamiento entre usuarios (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;
  let extra: TestUser | undefined;
  let instrumentId: string;
  let otherInstrumentId: string; // sin filas en ninguna watchlist: aísla el chequeo de la FK compuesta

  let aPortfolioId: string;
  let aAccountId: string;
  let aWatchlistId: string;
  let aTxId: string;
  let aImportId: string;
  let bAccountId: string;
  let bPortfolioId: string;
  let bWatchlistId: string;

  const buyRow = (
    userId: string,
    accountId: string,
    overrides: Partial<TxInsert> = {},
  ): TxInsert => ({
    user_id: userId,
    account_id: accountId,
    type: "BUY",
    instrument_id: instrumentId,
    executed_at: "2026-01-02T15:00:00Z",
    quantity: 1,
    price: 100,
    fee: 0,
    ...overrides,
  });

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "a");
    b = await createTestUser(admin, "b");

    instrumentId = must(
      await admin
        .from("instruments")
        .insert({
          symbol: randomSymbol(),
          name: "Instrumento de prueba",
          type: "ETF",
        })
        .select("id")
        .single(),
      "instrumento",
    ).id;
    otherInstrumentId = must(
      await admin
        .from("instruments")
        .insert({
          symbol: randomSymbol(),
          name: "Otro instrumento de prueba",
          type: "STOCK",
        })
        .select("id")
        .single(),
      "otro instrumento",
    ).id;
    ok(
      await admin.from("prices_daily").insert({
        instrument_id: instrumentId,
        date: "2026-01-02",
        close: 100,
        adj_close: 100,
      }),
      "precio",
    );

    // Los datos iniciales de cada usuario los creó el trigger handle_new_user.
    const accountA = must(
      await a.client.from("accounts").select("id, portfolio_id").single(),
      "cuenta de A",
    );
    aAccountId = accountA.id;
    aPortfolioId = accountA.portfolio_id;
    aWatchlistId = must(
      await a.client.from("watchlists").select("id").single(),
      "watchlist de A",
    ).id;

    const accountB = must(
      await b.client.from("accounts").select("id, portfolio_id").single(),
      "cuenta de B",
    );
    bAccountId = accountB.id;
    bPortfolioId = accountB.portfolio_id;
    bWatchlistId = must(
      await b.client.from("watchlists").select("id").single(),
      "watchlist de B",
    ).id;

    aTxId = must(
      await a.client
        .from("transactions")
        .insert(buyRow(a.id, aAccountId, { notes: "de A" }))
        .select("id")
        .single(),
      "transacción de A",
    ).id;
    aImportId = must(
      await a.client
        .from("imports")
        .insert({
          user_id: a.id,
          account_id: aAccountId,
          source: "delta_csv",
          filename: "a.csv",
        })
        .select("id")
        .single(),
      "importación de A",
    ).id;
    ok(
      await a.client.from("watchlist_items").insert({
        watchlist_id: aWatchlistId,
        instrument_id: instrumentId,
        user_id: a.id,
      }),
      "item de watchlist de A",
    );
    // B también tiene filas en cada tabla de usuario (así "ve solo lo suyo" no es vacuo).
    ok(
      await b.client
        .from("transactions")
        .insert(buyRow(b.id, bAccountId, { notes: "de B" })),
      "transacción de B",
    );
    ok(
      await b.client.from("imports").insert({
        user_id: b.id,
        account_id: bAccountId,
        source: "delta_csv",
        filename: "b.csv",
      }),
      "importación de B",
    );
    ok(
      await b.client.from("watchlist_items").insert({
        watchlist_id: bWatchlistId,
        instrument_id: instrumentId,
        user_id: b.id,
      }),
      "item de watchlist de B",
    );
  }, 120_000);

  afterAll(async () => {
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
    await deleteTestUser(admin, extra);
    if (instrumentId) {
      await admin
        .from("prices_daily")
        .delete()
        .eq("instrument_id", instrumentId);
      await admin.from("instruments").delete().eq("id", instrumentId);
    }
    if (otherInstrumentId) {
      await admin.from("instruments").delete().eq("id", otherInstrumentId);
    }
  }, 120_000);

  describe("datos iniciales (trigger handle_new_user)", () => {
    it("cada usuario nuevo tiene perfil, portafolio, cuenta y watchlist", async () => {
      for (const user of [a, b]) {
        const profile = must(
          await user.client.from("profiles").select("*").single(),
          "perfil",
        );
        expect(profile.id).toBe(user.id);
        expect(profile.base_currency).toBe("USD");
        expect(profile.display_name).toBe(user.email.split("@")[0]);

        const portfolio = must(
          await user.client.from("portfolios").select("*").single(),
          "portafolio",
        );
        expect(portfolio).toMatchObject({
          user_id: user.id,
          name: "Portafolio principal",
          benchmark_symbol: "SPY",
        });

        const account = must(
          await user.client.from("accounts").select("*").single(),
          "cuenta",
        );
        expect(account).toMatchObject({
          user_id: user.id,
          portfolio_id: portfolio.id,
          name: "Cuenta principal",
          currency: "USD",
          cost_method: "AVERAGE",
        });

        const watchlist = must(
          await user.client.from("watchlists").select("*").single(),
          "watchlist",
        );
        expect(watchlist).toMatchObject({
          user_id: user.id,
          name: "Watchlist",
        });
      }
    });
  });

  describe("lectura", () => {
    it("cada usuario ve solo sus propias filas", async () => {
      for (const [me, other] of [
        [a, b],
        [b, a],
      ] as const) {
        for (const table of USER_TABLES) {
          const { data, error } = await loose(me.client)
            .from(table)
            .select("*");
          expect(error, `${table}: ${error?.message}`).toBeNull();
          const owners = (data ?? []).map((row) =>
            table === "profiles" ? row.id : row.user_id,
          );
          expect(owners.length, `${table} sin filas propias`).toBeGreaterThan(
            0,
          );
          expect(owners.every((owner) => owner === me.id)).toBe(true);
          expect(owners).not.toContain(other.id);
        }
      }
    });

    it("B no puede leer por id las filas de A", async () => {
      const targets: [string, string, string][] = [
        ["profiles", "id", a.id],
        ["portfolios", "id", aPortfolioId],
        ["accounts", "id", aAccountId],
        ["transactions", "id", aTxId],
        ["imports", "id", aImportId],
        ["watchlists", "id", aWatchlistId],
        ["watchlist_items", "watchlist_id", aWatchlistId],
      ];
      for (const [table, column, id] of targets) {
        const { data, error } = await loose(b.client)
          .from(table)
          .select("*")
          .eq(column, id);
        expect(error, `${table}: ${error?.message}`).toBeNull();
        expect(data, `${table} filtró filas de A`).toEqual([]);
      }
    });

    it("A tampoco ve lo de B", async () => {
      const { data, error } = await a.client
        .from("accounts")
        .select("id")
        .eq("id", bAccountId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe("modificación y borrado", () => {
    it("B no puede modificar ni borrar filas de A: 0 filas afectadas y nada cambia", async () => {
      const updates: [string, string, Record<string, unknown>, string][] = [
        ["transactions", aTxId, { notes: "hackeado" }, "id"],
        ["accounts", aAccountId, { name: "hackeado" }, "id"],
        ["portfolios", aPortfolioId, { name: "hackeado" }, "id"],
        ["watchlists", aWatchlistId, { name: "hackeado" }, "id"],
        ["imports", aImportId, { filename: "hackeado" }, "id"],
        ["profiles", a.id, { display_name: "hackeado" }, "id"],
      ];
      for (const [table, id, patch, column] of updates) {
        const result = await loose(b.client)
          .from(table)
          .update(patch)
          .eq(column, id)
          .select();
        expect(result.error, `${table}: ${result.error?.message}`).toBeNull();
        expect(result.data, `${table} modificó filas de A`).toEqual([]);
      }

      const deletes: [string, string, string][] = [
        ["transactions", "id", aTxId],
        ["accounts", "id", aAccountId],
        ["portfolios", "id", aPortfolioId],
        ["watchlists", "id", aWatchlistId],
        ["imports", "id", aImportId],
        ["watchlist_items", "watchlist_id", aWatchlistId],
      ];
      for (const [table, column, id] of deletes) {
        const result = await loose(b.client)
          .from(table)
          .delete()
          .eq(column, id)
          .select();
        expect(result.error, `${table}: ${result.error?.message}`).toBeNull();
        expect(result.data, `${table} borró filas de A`).toEqual([]);
      }

      // Con la clave secreta se comprueba que todo sigue intacto.
      const tx = must(
        await admin
          .from("transactions")
          .select("notes")
          .eq("id", aTxId)
          .single(),
        "transacción de A",
      );
      expect(tx.notes).toBe("de A");
      const account = must(
        await admin
          .from("accounts")
          .select("name")
          .eq("id", aAccountId)
          .single(),
        "cuenta de A",
      );
      expect(account.name).toBe("Cuenta principal");
      const profile = must(
        await admin
          .from("profiles")
          .select("display_name")
          .eq("id", a.id)
          .single(),
        "perfil de A",
      );
      expect(profile.display_name).toBe(a.email.split("@")[0]);
      const items = await admin
        .from("watchlist_items")
        .select("instrument_id")
        .eq("watchlist_id", aWatchlistId);
      expect(items.data).toHaveLength(1);
    });
  });

  describe("escritura a nombre de otro", () => {
    it("B no puede insertar filas con el user_id de A (política de RLS)", async () => {
      const attempts: [string, Record<string, unknown>][] = [
        ["transactions", buyRow(a.id, aAccountId)],
        ["portfolios", { user_id: a.id, name: "intruso" }],
        ["watchlists", { user_id: a.id, name: "intruso" }],
        [
          "imports",
          { user_id: a.id, account_id: aAccountId, source: "delta_csv" },
        ],
        [
          "watchlist_items",
          {
            watchlist_id: aWatchlistId,
            instrument_id: instrumentId,
            user_id: a.id,
          },
        ],
      ];
      for (const [table, row] of attempts) {
        const { error } = await loose(b.client).from(table).insert(row);
        expect(error?.code, `${table}: ${error?.message}`).toBe(
          PG.insufficientPrivilege,
        );
      }
    });

    it("B no puede colgar filas propias de la cuenta o el portafolio de A (FK compuesta)", async () => {
      const attempts: [string, Record<string, unknown>][] = [
        ["transactions", buyRow(b.id, aAccountId)],
        [
          "accounts",
          { user_id: b.id, portfolio_id: aPortfolioId, name: "colgada" },
        ],
        [
          "watchlist_items",
          {
            watchlist_id: aWatchlistId,
            instrument_id: otherInstrumentId,
            user_id: b.id,
          },
        ],
        [
          "imports",
          { user_id: b.id, account_id: aAccountId, source: "delta_csv" },
        ],
      ];
      for (const [table, row] of attempts) {
        const { error } = await loose(b.client).from(table).insert(row);
        expect(error?.code, `${table}: ${error?.message}`).toBe(
          PG.foreignKeyViolation,
        );
      }
    });

    it("B no puede mover una fila propia a A ni a su cuenta", async () => {
      const bTx = must(
        await b.client
          .from("transactions")
          .insert(buyRow(b.id, bAccountId, { notes: "mover" }))
          .select("id")
          .single(),
        "transacción de B",
      );

      const toA = await b.client
        .from("transactions")
        .update({ user_id: a.id })
        .eq("id", bTx.id);
      expect(toA.error?.code).toBe(PG.insufficientPrivilege);

      const toAccountOfA = await b.client
        .from("transactions")
        .update({ account_id: aAccountId })
        .eq("id", bTx.id);
      expect(toAccountOfA.error?.code).toBe(PG.foreignKeyViolation);

      const after = must(
        await admin
          .from("transactions")
          .select("user_id, account_id")
          .eq("id", bTx.id)
          .single(),
        "fila movida",
      );
      expect(after).toEqual({ user_id: b.id, account_id: bAccountId });
    });

    it("cada usuario sí puede escribir en lo suyo", async () => {
      const { error } = await b.client
        .from("portfolios")
        .update({ name: "Renombrado por B" })
        .eq("id", bPortfolioId);
      expect(error).toBeNull();
      const { data } = await b.client
        .from("portfolios")
        .select("name")
        .eq("id", bPortfolioId)
        .single();
      expect(data?.name).toBe("Renombrado por B");

      const watchlist = await b.client
        .from("watchlists")
        .insert({ user_id: b.id, name: "Otra de B" });
      expect(watchlist.error).toBeNull();
    });
  });

  describe("tablas de mercado y permisos por rol", () => {
    it("un usuario autenticado lee instrumentos y precios", async () => {
      const instrument = await a.client
        .from("instruments")
        .select("id, type")
        .eq("id", instrumentId);
      expect(instrument.error).toBeNull();
      expect(instrument.data).toEqual([{ id: instrumentId, type: "ETF" }]);

      const prices = await a.client
        .from("prices_daily")
        .select("close")
        .eq("instrument_id", instrumentId);
      expect(prices.error).toBeNull();
      expect(prices.data).toHaveLength(1);
    });

    it("un usuario autenticado no puede escribir en las tablas de mercado", async () => {
      const inserts: [string, Record<string, unknown>][] = [
        ["instruments", { symbol: randomSymbol(), type: "ETF" }],
        [
          "prices_daily",
          { instrument_id: instrumentId, date: "2026-02-02", close: 1 },
        ],
        [
          "quotes_latest",
          {
            instrument_id: instrumentId,
            price: 1,
            as_of: "2026-02-02T00:00:00Z",
          },
        ],
        [
          "corporate_actions",
          {
            instrument_id: instrumentId,
            type: "SPLIT",
            ex_date: "2026-02-02",
            ratio: 2,
          },
        ],
      ];
      for (const [table, row] of inserts) {
        const { error } = await loose(a.client).from(table).insert(row);
        expect(error?.code, `${table} insert: ${error?.message}`).toBe(
          PG.insufficientPrivilege,
        );
      }
      // Sin privilegio UPDATE/DELETE la base rechaza antes de mirar filas.
      const targets: [string, string, Record<string, unknown>][] = [
        ["instruments", "id", { name: "hackeado" }],
        ["prices_daily", "instrument_id", { close: 1 }],
        ["quotes_latest", "instrument_id", { price: 1 }],
        ["corporate_actions", "instrument_id", { amount: 1 }],
      ];
      for (const [table, column, patch] of targets) {
        const update = await loose(a.client)
          .from(table)
          .update(patch)
          .eq(column, instrumentId);
        expect(
          update.error?.code,
          `${table} update: ${update.error?.message}`,
        ).toBe(PG.insufficientPrivilege);
        const del = await loose(a.client)
          .from(table)
          .delete()
          .eq(column, instrumentId);
        expect(del.error?.code, `${table} delete: ${del.error?.message}`).toBe(
          PG.insufficientPrivilege,
        );
      }
    });

    it("sin sesión (rol anon) no se puede leer ninguna tabla", async () => {
      const anon = createAnon();
      for (const table of ALL_TABLES) {
        const { data, error } = await loose(anon)
          .from(table)
          .select("*")
          .limit(1);
        expect(error?.code, `${table}: ${error?.message}`).toBe(
          PG.insufficientPrivilege,
        );
        expect(data).toBeNull();
      }
    });

    it("un usuario autenticado no puede leer ni escribir allowed_emails", async () => {
      const read = await loose(a.client).from("allowed_emails").select("*");
      expect(read.error?.code).toBe(PG.insufficientPrivilege);
      const write = await loose(a.client)
        .from("allowed_emails")
        .insert({ email: "colado@example.com" });
      expect(write.error?.code).toBe(PG.insufficientPrivilege);
    });
  });

  describe("restricciones de transactions", () => {
    const insertAsA = (overrides: Partial<TxInsert>) =>
      a.client.from("transactions").insert({
        user_id: a.id,
        account_id: aAccountId,
        executed_at: "2026-01-03T15:00:00Z",
        ...overrides,
      } as TxInsert);

    it("acepta cada tipo de transacción bien formado", async () => {
      const valid: Partial<TxInsert>[] = [
        {
          type: "BUY",
          instrument_id: instrumentId,
          quantity: 0.5,
          price: 0,
          fee: 1,
        },
        {
          type: "SELL",
          instrument_id: instrumentId,
          quantity: 0.5,
          price: 120,
        },
        { type: "DIVIDEND", instrument_id: instrumentId, amount: 1.25 },
        { type: "SPLIT", instrument_id: instrumentId, split_ratio: 0.1 },
        { type: "DEPOSIT", amount: 1000 },
        { type: "WITHDRAWAL", amount: 10 },
        { type: "FEE", amount: 1.5 },
        { type: "TAX", amount: 0.3, instrument_id: instrumentId },
        { type: "INTEREST", amount: -2.5 }, // interés de margen
      ];
      for (const row of valid) {
        const { error } = await insertAsA(row);
        expect(error, `${row.type}: ${error?.message}`).toBeNull();
      }
    });

    it("rechaza las combinaciones inválidas con un CHECK", async () => {
      const invalid: [string, Partial<TxInsert>][] = [
        [
          "BUY con cantidad 0",
          { type: "BUY", instrument_id: instrumentId, quantity: 0, price: 1 },
        ],
        [
          "BUY sin cantidad",
          { type: "BUY", instrument_id: instrumentId, price: 1 },
        ],
        ["BUY sin instrumento", { type: "BUY", quantity: 1, price: 1 }],
        [
          "BUY con precio negativo",
          { type: "BUY", instrument_id: instrumentId, quantity: 1, price: -1 },
        ],
        [
          "SELL con comisión negativa",
          {
            type: "SELL",
            instrument_id: instrumentId,
            quantity: 1,
            price: 1,
            fee: -1,
          },
        ],
        [
          "DIVIDEND de 0",
          { type: "DIVIDEND", instrument_id: instrumentId, amount: 0 },
        ],
        ["DIVIDEND sin instrumento", { type: "DIVIDEND", amount: 1 }],
        [
          "SPLIT con razón 0",
          { type: "SPLIT", instrument_id: instrumentId, split_ratio: 0 },
        ],
        ["SPLIT sin razón", { type: "SPLIT", instrument_id: instrumentId }],
        ["DEPOSIT sin monto", { type: "DEPOSIT" }],
        ["DEPOSIT de 0", { type: "DEPOSIT", amount: 0 }],
        ["WITHDRAWAL negativo", { type: "WITHDRAWAL", amount: -5 }],
        ["INTEREST de 0", { type: "INTEREST", amount: 0 }],
        ["DEPOSIT con comisión", { type: "DEPOSIT", amount: 10, fee: 1 }],
        [
          "moneda en minúsculas",
          { type: "DEPOSIT", amount: 10, currency: "usd" },
        ],
        ["moneda de 2 letras", { type: "DEPOSIT", amount: 10, currency: "US" }],
        ["origen desconocido", { type: "DEPOSIT", amount: 10, source: "otro" }],
      ];
      for (const [name, row] of invalid) {
        const { error } = await insertAsA(row);
        expect(error?.code, `${name}: ${error?.message}`).toBe(
          PG.checkViolation,
        );
      }
    });

    it("seq conserva el orden de inserción aunque comparta created_at y executed_at", async () => {
      const marker = `orden-${Date.now()}`;
      const rows = [1, 2, 3].map((n) => ({
        user_id: a.id,
        account_id: aAccountId,
        type: "DEPOSIT" as const,
        amount: n,
        executed_at: "2026-03-01T12:00:00Z",
        notes: `${marker}-${n}`,
      }));
      const inserted = await a.client.from("transactions").insert(rows);
      expect(inserted.error).toBeNull();

      const { data, error } = await a.client
        .from("transactions")
        .select("notes, seq, created_at")
        .like("notes", `${marker}-%`)
        .order("seq", { ascending: true });
      expect(error).toBeNull();
      expect(data?.map((row) => row.notes)).toEqual([
        `${marker}-1`,
        `${marker}-2`,
        `${marker}-3`,
      ]);
      const seqs = (data ?? []).map((row) => Number(row.seq));
      expect(seqs[0]! < seqs[1]! && seqs[1]! < seqs[2]!).toBe(true);
      // Todas comparten created_at (una sola sentencia): por eso hace falta seq.
      expect(new Set((data ?? []).map((row) => row.created_at)).size).toBe(1);
    });

    it("no permite repetir (cuenta, origen, external_id) pero sí varias filas manuales", async () => {
      const first = await insertAsA({
        type: "DEPOSIT",
        amount: 1,
        source: "delta_csv",
        external_id: "ext-dup",
      });
      expect(first.error).toBeNull();
      const second = await insertAsA({
        type: "DEPOSIT",
        amount: 1,
        source: "delta_csv",
        external_id: "ext-dup",
      });
      expect(second.error?.code).toBe(PG.uniqueViolation);

      // Las filas manuales no tienen external_id (NULL): pueden repetirse.
      const m1 = await insertAsA({ type: "DEPOSIT", amount: 2 });
      const m2 = await insertAsA({ type: "DEPOSIT", amount: 2 });
      expect(m1.error).toBeNull();
      expect(m2.error).toBeNull();
    });
  });

  describe("cascadas", () => {
    it("borrar una cuenta borra sus transacciones y conserva las importaciones sin cuenta", async () => {
      const portfolio = must(
        await a.client
          .from("portfolios")
          .insert({ user_id: a.id, name: "Extra" })
          .select("id")
          .single(),
        "portafolio extra",
      );
      const account = must(
        await a.client
          .from("accounts")
          .insert({ user_id: a.id, portfolio_id: portfolio.id, name: "Extra" })
          .select("id")
          .single(),
        "cuenta extra",
      );
      ok(
        await a.client
          .from("transactions")
          .insert(buyRow(a.id, account.id, { notes: "extra" })),
        "transacción extra",
      );
      const imp = must(
        await a.client
          .from("imports")
          .insert({
            user_id: a.id,
            account_id: account.id,
            source: "delta_csv",
          })
          .select("id")
          .single(),
        "importación extra",
      );

      const deleted = await a.client
        .from("accounts")
        .delete()
        .eq("id", account.id)
        .select();
      expect(deleted.error).toBeNull();
      expect(deleted.data).toHaveLength(1);

      const txs = await a.client
        .from("transactions")
        .select("id")
        .eq("account_id", account.id);
      expect(txs.data).toEqual([]);
      const kept = must(
        await a.client
          .from("imports")
          .select("account_id, user_id")
          .eq("id", imp.id)
          .single(),
        "importación conservada",
      );
      expect(kept).toEqual({ account_id: null, user_id: a.id });

      // Borrar el portafolio borra sus cuentas.
      const account2 = must(
        await a.client
          .from("accounts")
          .insert({
            user_id: a.id,
            portfolio_id: portfolio.id,
            name: "Extra 2",
          })
          .select("id")
          .single(),
        "cuenta extra 2",
      );
      const delPortfolio = await a.client
        .from("portfolios")
        .delete()
        .eq("id", portfolio.id);
      expect(delPortfolio.error).toBeNull();
      const gone = await a.client
        .from("accounts")
        .select("id")
        .eq("id", account2.id);
      expect(gone.data).toEqual([]);
    });

    it("borrar el usuario borra todas sus filas", async () => {
      extra = await createTestUser(admin, "c");
      const account = must(
        await extra.client.from("accounts").select("id").single(),
        "cuenta de C",
      );
      ok(
        await extra.client
          .from("transactions")
          .insert(buyRow(extra.id, account.id)),
        "transacción de C",
      );

      const { error } = await admin.auth.admin.deleteUser(extra.id);
      expect(error).toBeNull();

      for (const table of USER_TABLES) {
        const column = table === "profiles" ? "id" : "user_id";
        const { data } = await loose(admin)
          .from(table)
          .select("*")
          .eq(column, extra.id);
        expect(data, `${table} conserva filas de un usuario borrado`).toEqual(
          [],
        );
      }
      extra = undefined; // ya está borrado
    });
  });
});
