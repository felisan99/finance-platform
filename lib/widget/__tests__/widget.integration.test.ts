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
import { buildDashboard } from "@/lib/portfolio/dashboard";
import { listPortfolios, loadScopeSnapshot } from "@/lib/portfolio/queries";
import type { PortfolioRef } from "@/lib/portfolio/portfolio-scope";
import type { MarketDataProvider, Quote } from "@/lib/market-data";
import { loadWidget } from "../data";
import type { WidgetQuoteDeps } from "../quotes";
import { generateWidgetToken, hashWidgetToken } from "../token";
import { buildWidgetView } from "../view";

// Widget de iPhone contra finance-dev (`pnpm test:integration`): `create_widget_token`,
// `widget_ledger` (solo la clave secreta, solo los datos del dueño del código, con límite) y que
// el resumen sea el mismo que ve la persona con su sesión. También la actualización de cotizaciones
// a demanda (`quotes.ts`), con un proveedor falso: estos tests no salen a Yahoo.

const NOW = new Date("2026-10-06T18:00:00Z");
const NOT_FOUND = "00000000-0000-0000-0000-000000000000";
const HOUR = 60 * 60 * 1000;

/** Proveedor falso: anota qué símbolos le pidieron y responde con `respond`. */
function fakeQuotes(
  respond: (symbols: string[]) => Promise<Quote[]> = async () => [],
  timeoutMs = 2000,
): { deps: WidgetQuoteDeps; calls: string[][] } {
  const calls: string[][] = [];
  const provider: MarketDataProvider = {
    name: "fake",
    search: async () => [],
    getQuotes: (symbols) => {
      calls.push(symbols);
      return respond(symbols);
    },
    getDailyHistory: async () => {
      throw new Error("no se usa");
    },
  };
  return { deps: { provider: async () => provider, timeoutMs }, calls };
}

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

describe("widget de iPhone (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;
  let instrumentId: string;
  let main: PortfolioRef;
  let crypto: PortfolioRef;
  let bMain: PortfolioRef;

  /** El widget sin salir a Yahoo: el proveedor falso no devuelve cotizaciones. */
  const load = (hash: string) =>
    loadWidget(admin, hash, NOW, { quoteDeps: fakeQuotes().deps });

  /** Crea (o reemplaza) el código de `user` con su sesión y devuelve el hash. */
  async function createToken(
    user: TestUser,
    portfolioId: string | null = null,
  ): Promise<string> {
    const hash = hashWidgetToken(generateWidgetToken());
    const { error } = await user.client.rpc("create_widget_token", {
      p_token_hash: hash,
      p_portfolio_id: portfolioId as string,
    });
    if (error) throw new Error(`create_widget_token: ${error.message}`);
    return hash;
  }

  async function insertTx(
    user: TestUser,
    accountId: string,
    rows: Array<Record<string, unknown>>,
  ) {
    must(
      await user.client
        .from("transactions")
        .insert(
          rows.map((row) => ({
            user_id: user.id,
            account_id: accountId,
            executed_at: "2026-09-01T15:00:00Z",
            ...row,
          })) as never,
        )
        .select("id"),
      "transacciones",
    );
  }

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "widget-a");
    b = await createTestUser(admin, "widget-b");

    instrumentId = must(
      await admin
        .from("instruments")
        .insert({ symbol: randomSymbol(), name: "Widget", type: "STOCK" })
        .select("id")
        .single(),
      "instrumento",
    ).id;
    must(
      await admin
        .from("prices_daily")
        .insert([
          { instrument_id: instrumentId, date: "2026-10-01", close: 110 },
          { instrument_id: instrumentId, date: "2026-10-02", close: 120 },
        ])
        .select("date"),
      "precios",
    );

    must(await a.client.rpc("create_portfolio", { p_name: "Cripto" }), "alta");
    [main, crypto] = (await listPortfolios(a.client)) as [
      PortfolioRef,
      PortfolioRef,
    ];
    [bMain] = (await listPortfolios(b.client)) as [PortfolioRef];

    await insertTx(a, main.account.id, [
      { type: "DEPOSIT", amount: "1000" },
      {
        type: "BUY",
        instrument_id: instrumentId,
        quantity: "2",
        price: "100",
        executed_at: "2026-09-02T15:00:00Z",
      },
    ]);
    await insertTx(a, crypto.account.id, [{ type: "DEPOSIT", amount: "50" }]);
    await insertTx(b, bMain.account.id, [{ type: "DEPOSIT", amount: "777" }]);
  });

  afterAll(async () => {
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
    if (instrumentId) {
      await admin
        .from("prices_daily")
        .delete()
        .eq("instrument_id", instrumentId);
      await admin.from("instruments").delete().eq("id", instrumentId);
    }
  });

  it("widget_ledger solo lo ejecuta la clave secreta; create_widget_token exige sesión", async () => {
    const hash = hashWidgetToken(generateWidgetToken());
    for (const client of [createAnon(), a.client]) {
      const { error } = await client.rpc("widget_ledger", {
        p_token_hash: hash,
      });
      expect(error?.code).toBe(PG.insufficientPrivilege);
    }
    const { error } = await createAnon().rpc("create_widget_token", {
      p_token_hash: hash,
      p_portfolio_id: null as unknown as string,
    });
    expect(error?.code).toBe(PG.insufficientPrivilege);
  });

  it("la persona ve su código sin el hash y no puede escribir la tabla directamente", async () => {
    await createToken(a);
    const row = must(
      await a.client
        .from("widget_tokens")
        .select("user_id, portfolio_id, last_used_at")
        .single(),
      "código de A",
    );
    expect(row).toEqual({
      user_id: a.id,
      portfolio_id: null,
      last_used_at: null,
    });

    const hidden = await a.client.from("widget_tokens").select("token_hash");
    expect(hidden.error?.code).toBe(PG.insufficientPrivilege);

    const insert = await a.client.from("widget_tokens").insert({
      user_id: a.id,
      token_hash: hashWidgetToken(generateWidgetToken()),
    });
    expect(insert.error?.code).toBe(PG.insufficientPrivilege);

    // B no ve el de A.
    expect(
      must(await b.client.from("widget_tokens").select("user_id"), "B"),
    ).toEqual([]);
  });

  it("todo junto: el resumen del widget es el mismo que ve la persona con su sesión", async () => {
    const hash = await createToken(a);
    const outcome = await load(hash);

    const portfolios = await listPortfolios(a.client);
    const snapshot = await loadScopeSnapshot(a.client, {
      kind: "all",
      portfolios,
    });
    const expected = buildWidgetView(
      buildDashboard(snapshot.valued, snapshot.transactions, NOW),
      NOW,
      "Todos los portafolios",
    );
    expect(outcome).toEqual({ kind: "ok", view: expected });
    if (outcome.kind !== "ok") return;
    // 1050 depositados; 2 a 100 => efectivo 850 + 2 × 120 = 1090.
    expect(outcome.view.totalValue.replace(/\s/g, " ")).toBe("US$ 1.090,00");
    expect(outcome.view.positions).toHaveLength(1);

    const used = must(
      await a.client.from("widget_tokens").select("last_used_at").single(),
      "último uso",
    );
    expect(used.last_used_at).not.toBeNull();
  });

  it("con un portafolio elegido, solo ese: ni los otros de la persona ni los de nadie más", async () => {
    const hash = await createToken(a, crypto.id);
    const ledger = must(
      await admin.rpc("widget_ledger", { p_token_hash: hash }),
      "widget_ledger",
    ) as {
      portfolios: Array<{ id: string }>;
      transactions: Array<{ account_id: string }>;
    };
    expect(ledger.portfolios.map((p) => p.id)).toEqual([crypto.id]);
    expect(new Set(ledger.transactions.map((t) => t.account_id))).toEqual(
      new Set([crypto.account.id]),
    );

    const outcome = await load(hash);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.view.title).toBe("Cripto");
    expect(outcome.view.totalValue.replace(/\s/g, " ")).toBe("US$ 50,00");
  });

  it("el código de B solo trae lo de B, y A no puede elegir un portafolio ajeno", async () => {
    const hash = await createToken(b);
    const outcome = await load(hash);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.view.title).toBeNull();
    expect(outcome.view.totalValue.replace(/\s/g, " ")).toBe("US$ 777,00");

    for (const portfolioId of [bMain.id, NOT_FOUND]) {
      const { error } = await a.client.rpc("create_widget_token", {
        p_token_hash: hashWidgetToken(generateWidgetToken()),
        p_portfolio_id: portfolioId,
      });
      expect(error?.code).toBe("22023");
    }
  });

  it("reemplazar o revocar deja sin efecto el código anterior", async () => {
    const old = await createToken(a);
    const current = await createToken(a);
    expect(await load(old)).toEqual({ kind: "unknown" });
    expect((await load(current)).kind).toBe("ok");

    must(
      await a.client
        .from("widget_tokens")
        .delete()
        .eq("user_id", a.id)
        .select("user_id"),
      "revocar",
    );
    expect(await load(current)).toEqual({ kind: "unknown" });
  });

  it("límite: pasados 60 usos en la hora devuelve `limited`; con la ventana vencida vuelve a andar", async () => {
    const hash = await createToken(a);
    must(
      await admin
        .from("widget_tokens")
        .update({ window_count: 60 })
        .eq("user_id", a.id)
        .select("user_id"),
      "contador",
    );
    expect(await load(hash)).toEqual({ kind: "limited" });

    must(
      await admin
        .from("widget_tokens")
        .update({ window_start: "2026-01-01T00:00:00Z" })
        .eq("user_id", a.id)
        .select("user_id"),
      "ventana",
    );
    expect((await load(hash)).kind).toBe("ok");
  });

  describe("un widget por portafolio (campo Parameter)", () => {
    const named = (hash: string, portfolioName: string) =>
      loadWidget(admin, hash, NOW, {
        portfolioName,
        quoteDeps: fakeQuotes().deps,
      });

    it("con un código de «Todos», el widget elige el portafolio por su nombre (sin mayúsculas ni espacios)", async () => {
      const hash = await createToken(a);
      const crypto_ = await named(hash, "  cRIPTO ");
      expect(crypto_.kind).toBe("ok");
      if (crypto_.kind !== "ok") return;
      expect(crypto_.view.title).toBe("Cripto");
      expect(crypto_.view.totalValue.replace(/\s/g, " ")).toBe("US$ 50,00");

      const principal = await named(hash, main.name);
      expect(principal.kind).toBe("ok");
      if (principal.kind === "ok") expect(principal.view.title).toBe(main.name);

      expect(await named(hash, "No existe")).toEqual({
        kind: "unknown_portfolio",
      });
      // La respuesta no dice qué portafolios hay.
      expect(
        (
          await admin.rpc("widget_ledger", {
            p_token_hash: hash,
            p_portfolio_name: "No existe",
          })
        ).data,
      ).toEqual({ unknown_portfolio: true });
    });

    it("el nombre de un portafolio de otra persona no sirve, y un código de un solo portafolio no muestra otro", async () => {
      must(
        await b.client.rpc("create_portfolio", { p_name: "Exclusivo B" }),
        "portafolio de B",
      );
      const all = await createToken(a);
      expect(await named(all, "Exclusivo B")).toEqual({
        kind: "unknown_portfolio",
      });

      const scoped = await createToken(a, crypto.id);
      expect(await named(scoped, main.name)).toEqual({
        kind: "unknown_portfolio",
      });
      expect((await named(scoped, "cripto")).kind).toBe("ok");
    });
  });

  describe("cotizaciones a demanda", () => {
    let symbol: string;
    const quote = (price: string, change: string): Quote => ({
      symbol,
      price,
      change,
      changePct: null,
      asOf: new Date(),
      currency: "USD",
    });
    /** Deja que el código vuelva a intentar ya (el freno es de 10 minutos). */
    const allowAttempt = async () =>
      must(
        await admin
          .from("widget_tokens")
          .update({ quotes_attempted_at: null })
          .eq("user_id", a.id)
          .select("user_id"),
        "freno",
      );
    const total = (outcome: Awaited<ReturnType<typeof loadWidget>>) =>
      outcome.kind === "ok"
        ? outcome.view.totalValue.replace(/\s/g, " ")
        : outcome.kind;

    beforeAll(async () => {
      symbol = must(
        await admin
          .from("instruments")
          .select("symbol")
          .eq("id", instrumentId)
          .single(),
        "símbolo",
      ).symbol;
    });

    it("sin cotización, la pide (solo las posiciones abiertas, en una llamada) y la usa en el resumen", async () => {
      const hash = await createToken(a, main.id);
      await allowAttempt();
      const fake = fakeQuotes(async () => [quote("130", "10")]);

      const outcome = await loadWidget(admin, hash, new Date(), {
        quoteDeps: fake.deps,
      });
      expect(fake.calls).toEqual([[symbol]]);
      // Solo el principal: 800 de efectivo (1000 − 2 × 100) + 2 × 130; el día: 2 × 10.
      expect(total(outcome)).toBe("US$ 1.060,00");
      if (outcome.kind === "ok") {
        expect(outcome.view.dayChange?.replace(/\s/g, " ")).toBe("+US$ 20,00");
      }

      const row = must(
        await admin
          .from("quotes_latest")
          .select("fetched_at")
          .eq("instrument_id", instrumentId)
          .single(),
        "cotización",
      );
      expect(row.fetched_at).not.toBeNull();
    });

    it("con menos de 2 horas no vuelve a pedir; pasadas 2 horas sí, pero no más de un intento cada 10 minutos", async () => {
      const hash = await createToken(a, main.id);
      await allowAttempt();
      const fake = fakeQuotes(async () => [quote("140", "20")]);

      await loadWidget(admin, hash, new Date(), { quoteDeps: fake.deps });
      expect(fake.calls).toEqual([]);

      // Dentro de 3 horas, la cotización ya es vieja: la pide.
      const later = new Date(Date.now() + 3 * HOUR);
      expect(
        total(await loadWidget(admin, hash, later, { quoteDeps: fake.deps })),
      ).toBe("US$ 1.080,00");
      expect(fake.calls).toHaveLength(1);

      // Otra vez "dentro de 3 horas" (vieja otra vez), pero el código intentó hace un instante.
      await loadWidget(admin, hash, new Date(Date.now() + 6 * HOUR), {
        quoteDeps: fake.deps,
      });
      expect(fake.calls).toHaveLength(1);
    });

    it("si el proveedor falla o tarda, muestra lo guardado", async () => {
      const hash = await createToken(a, main.id);
      const later = new Date(Date.now() + 3 * HOUR);

      await allowAttempt();
      const failing = fakeQuotes(async () => {
        throw new Error("yahoo caído");
      });
      expect(
        total(
          await loadWidget(admin, hash, later, { quoteDeps: failing.deps }),
        ),
      ).toBe("US$ 1.080,00");
      expect(failing.calls).toHaveLength(1);

      await allowAttempt();
      const hanging = fakeQuotes(() => new Promise<Quote[]>(() => {}), 200);
      expect(
        total(
          await loadWidget(admin, hash, later, { quoteDeps: hanging.deps }),
        ),
      ).toBe("US$ 1.080,00");
      expect(hanging.calls).toHaveLength(1);
    });

    it("take_widget_quote_refresh solo lo ejecuta la clave secreta", async () => {
      const hash = hashWidgetToken(generateWidgetToken());
      for (const client of [createAnon(), a.client]) {
        const { error } = await client.rpc("take_widget_quote_refresh", {
          p_token_hash: hash,
        });
        expect(error?.code).toBe(PG.insufficientPrivilege);
      }
      const unknown = await admin.rpc("take_widget_quote_refresh", {
        p_token_hash: hash,
      });
      expect(unknown.data).toBe(false);

      const columns = await a.client
        .from("widget_tokens")
        .select("quotes_attempted_at");
      expect(columns.error?.code).toBe(PG.insufficientPrivilege);
    });
  });

  it("borrar el portafolio elegido borra el código (no pasa a mostrar todo)", async () => {
    const hash = await createToken(a, crypto.id);
    must(
      await a.client
        .from("portfolios")
        .delete()
        .eq("id", crypto.id)
        .select("id"),
      "borrar portafolio",
    );
    expect(await load(hash)).toEqual({ kind: "unknown" });
    expect(
      must(await a.client.from("widget_tokens").select("user_id"), "A"),
    ).toEqual([]);
  });
});
