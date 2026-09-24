import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAdmin,
  createTestUserRecord,
  deleteTestUser,
  randomSymbol,
  type DbClient,
  type TestUserRecord,
} from "@/lib/db/__tests__/integration-helpers";
import { createSupabaseMarketStore, runMarketJob, type MarketStore } from "..";
import { FakeMarket, businessDays } from "./memory";

// El adaptador de Supabase contra finance-dev (ver assertDevProject): usuarios e instrumentos de
// prueba que se crean y se borran, sin Yahoo (el mercado es el falso de los tests unitarios).

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
  if (result.error)
    throw new Error(`Preparación: ${what}: ${result.error.message}`);
}

describe("SupabaseMarketStore (integración, finance-dev)", () => {
  let admin: DbClient;
  let store: MarketStore;
  let a: TestUserRecord;
  let b: TestUserRecord;
  let aAccountId: string;
  let bAccountId: string;
  let aWatchlistId: string;
  const instrumentIds: string[] = [];
  const runIds: string[] = [];

  async function newInstrument(
    overrides: {
      name?: string | null;
      type?: "STOCK" | "ETF" | null;
      symbol?: string;
    } = {},
  ) {
    const symbol = overrides.symbol ?? randomSymbol();
    const row = must(
      await admin
        .from("instruments")
        .insert({
          symbol,
          name:
            overrides.name === undefined
              ? "Instrumento de prueba"
              : overrides.name,
          type: overrides.type === undefined ? "STOCK" : overrides.type,
        })
        .select("id, symbol")
        .single(),
      "instrumento",
    );
    instrumentIds.push(row.id);
    return row;
  }

  async function addTx(
    user: TestUserRecord,
    accountId: string,
    instrumentId: string,
    executedAt: string,
    type: "BUY" | "SELL" = "BUY",
  ) {
    ok(
      await admin.from("transactions").insert({
        user_id: user.id,
        account_id: accountId,
        type,
        instrument_id: instrumentId,
        executed_at: executedAt,
        quantity: 1,
        price: 100,
        fee: 0,
      }),
      "transacción",
    );
  }

  /** El store real, pero viendo solo los instrumentos de este test (finance-dev puede tener otros). */
  const scoped = (ids: string[]): MarketStore => ({
    ...store,
    listActiveInstruments: async () =>
      (await store.listActiveInstruments()).filter((i) => ids.includes(i.id)),
  });

  // PostgREST corta cada respuesta en 1000 filas (max-rows): una serie de 5 años (~1260 ruedas) se
  // lee por páginas. Sin paginar, `.limit(5000)` devuelve 1000 y se trunca en silencio.
  const dbPrices = async (instrumentId: string) => {
    const rows: Array<{
      date: string;
      close: number;
      adj_close: number | null;
    }> = [];
    for (let offset = 0; ; offset += 1000) {
      const page = must(
        await admin
          .from("prices_daily")
          .select("date, close, adj_close")
          .eq("instrument_id", instrumentId)
          .order("date")
          .range(offset, offset + 999),
        "precios",
      );
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows.map((r) => ({
      date: r.date,
      close: String(r.close),
      adjClose: r.adj_close === null ? null : String(r.adj_close),
    }));
  };

  beforeAll(async () => {
    admin = createAdmin();
    store = createSupabaseMarketStore(admin);
    a = await createTestUserRecord(admin, "mkt-a");
    b = await createTestUserRecord(admin, "mkt-b");
    const account = async (u: TestUserRecord) =>
      must(
        await admin.from("accounts").select("id").eq("user_id", u.id).single(),
        "cuenta",
      ).id;
    aAccountId = await account(a);
    bAccountId = await account(b);
    aWatchlistId = must(
      await admin.from("watchlists").select("id").eq("user_id", a.id).single(),
      "watchlist",
    ).id;
  });

  afterAll(async () => {
    // Usuarios primero: sus transacciones y watchlist_items referencian a los instrumentos.
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
    if (runIds.length > 0)
      await admin.from("market_job_runs").delete().in("id", runIds);
    if (instrumentIds.length > 0) {
      // prices_daily, quotes_latest y corporate_actions se van en cascada.
      const { error } = await admin
        .from("instruments")
        .delete()
        .in("id", instrumentIds);
      if (error)
        console.warn(
          `No se pudieron borrar los instrumentos de prueba: ${error.message}`,
        );
    }
  });

  describe("listActiveInstruments", () => {
    it("devuelve lo que tiene transacciones o watchlist, de cualquier usuario, con la primera fecha", async () => {
      const shared = await newInstrument();
      const watched = await newInstrument();
      const closed = await newInstrument();
      const orphan = await newInstrument();
      // A y B operan el mismo instrumento: manda la fecha más antigua, sea de quien sea.
      await addTx(a, aAccountId, shared.id, "2026-05-20T15:00:00Z");
      await addTx(b, bAccountId, shared.id, "2026-03-09T23:34:00Z");
      // Posición ya cerrada: sigue activa (el historial valúa el período en que se tuvo).
      await addTx(a, aAccountId, closed.id, "2026-04-01T15:00:00Z", "BUY");
      await addTx(a, aAccountId, closed.id, "2026-04-02T15:00:00Z", "SELL");
      ok(
        await admin.from("watchlist_items").insert({
          watchlist_id: aWatchlistId,
          user_id: a.id,
          instrument_id: watched.id,
        }),
        "watchlist_item",
      );

      const active = await store.listActiveInstruments();
      const byId = new Map(active.map((i) => [i.id, i]));

      expect(byId.get(shared.id)).toEqual({
        id: shared.id,
        symbol: shared.symbol,
        providerSymbol: null,
        historyBackfilledAt: null,
        historyFrom: null,
        firstTxDate: "2026-03-09",
        inWatchlist: false,
        latestPriceDate: null,
      });
      expect(byId.get(watched.id)).toMatchObject({
        firstTxDate: null,
        inWatchlist: true,
      });
      expect(byId.get(closed.id)).toMatchObject({
        firstTxDate: "2026-04-01",
        inWatchlist: false,
      });
      expect(byId.has(orphan.id)).toBe(false);
    });

    it("incluye el benchmark de un portafolio con operaciones, desde la primera transacción del portafolio (y solo entonces)", async () => {
      const benchmark = await newInstrument();
      const held = await newInstrument();
      const c = await createTestUserRecord(admin, "mkt-c");
      try {
        const cAccountId = must(
          await admin
            .from("accounts")
            .select("id")
            .eq("user_id", c.id)
            .single(),
          "cuenta",
        ).id;
        ok(
          await admin
            .from("portfolios")
            .update({ benchmark_symbol: benchmark.symbol })
            .eq("user_id", c.id),
          "benchmark del portafolio",
        );
        const ids = () =>
          store
            .listActiveInstruments()
            .then((all) => new Map(all.map((i) => [i.id, i])));

        // Sin operaciones, su benchmark no hace falta.
        expect((await ids()).has(benchmark.id)).toBe(false);

        // Con operaciones: el benchmark entra con la fecha de la primera del portafolio.
        await addTx(c, cAccountId, held.id, "2026-05-12T15:00:00Z");
        await addTx(c, cAccountId, held.id, "2026-03-06T15:00:00Z");
        expect((await ids()).get(benchmark.id)).toMatchObject({
          firstTxDate: "2026-03-06",
          inWatchlist: false,
        });

        // Si además lo tiene en cartera, manda la fecha más antigua de las dos.
        await addTx(c, cAccountId, benchmark.id, "2026-02-02T15:00:00Z");
        expect((await ids()).get(benchmark.id)).toMatchObject({
          firstTxDate: "2026-02-02",
        });
      } finally {
        await deleteTestUser(admin, c);
      }
    });

    it("refleja el último precio, el backfill y el símbolo del proveedor", async () => {
      const inst = await newInstrument();
      await addTx(a, aAccountId, inst.id, "2026-03-09T15:00:00Z");
      await store.upsertPrices(inst.id, [
        { date: "2026-09-21", close: "10", adjClose: null },
        { date: "2026-09-23", close: "11", adjClose: null },
        { date: "2026-09-22", close: "10.5", adjClose: null },
      ]);
      await store.markBackfilled(inst.id, {
        at: new Date("2026-09-24T22:00:00Z"),
        from: "2026-03-02",
      });
      ok(
        await admin
          .from("instruments")
          .update({ provider_symbol: "ZT-B" })
          .eq("id", inst.id),
        "provider_symbol",
      );

      const row = (await store.listActiveInstruments()).find(
        (i) => i.id === inst.id,
      );

      expect(row).toMatchObject({
        latestPriceDate: "2026-09-23",
        historyFrom: "2026-03-02",
        providerSymbol: "ZT-B",
      });
      expect(new Date(row?.historyBackfilledAt ?? "").toISOString()).toBe(
        "2026-09-24T22:00:00.000Z",
      );
    });
  });

  describe("precios", () => {
    it("upsertPrices es idempotente, actualiza por (instrumento, fecha) y conserva los decimales", async () => {
      const inst = await newInstrument();
      await store.upsertPrices(inst.id, [
        { date: "2026-09-21", close: "1730.98", adjClose: "1700.123456" },
        { date: "2026-09-22", close: "0.5123", adjClose: null },
      ]);
      await store.upsertPrices(inst.id, [
        { date: "2026-09-22", close: "0.5124", adjClose: "0.5" },
        { date: "2026-09-21", close: "1730.98", adjClose: "1700.123456" },
      ]);

      expect(await dbPrices(inst.id)).toEqual([
        { date: "2026-09-21", close: "1730.98", adjClose: "1700.123456" },
        { date: "2026-09-22", close: "0.5124", adjClose: "0.5" },
      ]);
    });

    it("guarda más de 500 filas (varios lotes) y no pierde ninguna", async () => {
      const inst = await newInstrument();
      const dates = businessDays("2021-01-01", "2026-09-23"); // ~1.400 ruedas
      expect(dates.length).toBeGreaterThan(1000);
      await store.upsertPrices(
        inst.id,
        dates.map((date, i) => ({
          date,
          close: String(10 + i),
          adjClose: null,
        })),
      );

      const stored = await dbPrices(inst.id);
      expect(stored).toHaveLength(dates.length);
      expect(stored[0]).toMatchObject({ date: dates[0], close: "10" });
      expect(stored.at(-1)).toMatchObject({
        date: dates.at(-1),
        close: String(10 + dates.length - 1),
      });
    });

    it("getStoredCloses devuelve desde la fecha indicada, ordenado y como string", async () => {
      const inst = await newInstrument();
      await store.upsertPrices(inst.id, [
        { date: "2026-09-22", close: "12.5", adjClose: null },
        { date: "2026-09-18", close: "10", adjClose: null },
        { date: "2026-09-21", close: "11.25", adjClose: null },
      ]);
      expect(await store.getStoredCloses(inst.id, "2026-09-21")).toEqual([
        { date: "2026-09-21", close: "11.25" },
        { date: "2026-09-22", close: "12.5" },
      ]);
      expect(await store.getStoredCloses(inst.id, "2027-01-01")).toEqual([]);
    });

    it("pruneStalePrices borra solo lo posterior a `from` que no está en la lista (con paginado y varios lotes)", async () => {
      const inst = await newInstrument();
      const dates = businessDays("2021-01-01", "2026-09-23");
      await store.upsertPrices(
        inst.id,
        dates.map((date) => ({ date, close: "1", adjClose: null })),
      );
      const from = "2022-01-03";
      const inRange = dates.filter((d) => d >= from);
      expect(inRange.length).toBeGreaterThan(1200); // más de una página de 1000 filas
      // Quedan 300 viejas (más de un lote de 100 para borrar): 150 al principio del rango y 150
      // al final. Las del final están en la segunda página de lectura: si la poda no paginara,
      // no las vería y las dejaría sin borrar.
      const keep = inRange.slice(150, -150);

      const removed = await store.pruneStalePrices(inst.id, from, keep);

      expect(removed).toBe(300);
      const left = (await dbPrices(inst.id)).map((r) => r.date);
      expect(left.filter((d) => d >= from)).toEqual(keep);
      // Lo anterior a `from` no se toca.
      expect(left.filter((d) => d < from)).toEqual(
        dates.filter((d) => d < from),
      );
    });

    it("pruneStalePrices sin nada para borrar devuelve 0 y no toca nada", async () => {
      const inst = await newInstrument();
      await store.upsertPrices(inst.id, [
        { date: "2026-09-21", close: "1", adjClose: null },
        { date: "2026-09-22", close: "2", adjClose: null },
      ]);
      expect(
        await store.pruneStalePrices(inst.id, "2026-09-01", [
          "2026-09-21",
          "2026-09-22",
        ]),
      ).toBe(0);
      expect(await dbPrices(inst.id)).toHaveLength(2);
    });
  });

  describe("acciones corporativas y cotizaciones", () => {
    it("guarda splits y dividendos con su ratio o importe, sin duplicar", async () => {
      const inst = await newInstrument();
      const actions = [
        { type: "SPLIT", exDate: "2026-03-02", ratio: "0.33333333" },
        { type: "SPLIT", exDate: "2026-06-01", ratio: "10" },
        { type: "DIVIDEND", exDate: "2026-06-26", amount: "1.962" },
      ] as const;
      await store.upsertCorporateActions(inst.id, [...actions]);
      await store.upsertCorporateActions(inst.id, [...actions]); // idempotente
      await store.upsertCorporateActions(inst.id, []); // vacío: no consulta

      expect(await store.getStoredActionKeys(inst.id)).toEqual(
        new Set([
          "SPLIT|2026-03-02",
          "SPLIT|2026-06-01",
          "DIVIDEND|2026-06-26",
        ]),
      );
      const rows = must(
        await admin
          .from("corporate_actions")
          .select("type, ex_date, ratio, amount")
          .eq("instrument_id", inst.id)
          .order("ex_date"),
        "acciones",
      );
      expect(rows).toEqual([
        {
          type: "SPLIT",
          ex_date: "2026-03-02",
          ratio: 0.33333333,
          amount: null,
        },
        { type: "SPLIT", ex_date: "2026-06-01", ratio: 10, amount: null },
        { type: "DIVIDEND", ex_date: "2026-06-26", ratio: null, amount: 1.962 },
      ]);
    });

    it("upsertQuotes crea y luego actualiza la cotización de cada instrumento", async () => {
      const one = await newInstrument();
      const two = await newInstrument();
      const asOf = new Date("2026-09-23T20:00:00.000Z");
      await store.upsertQuotes([
        {
          instrumentId: one.id,
          quote: {
            symbol: "A",
            price: "707.6",
            change: "-5.18",
            changePct: "-0.007267",
            asOf,
            currency: "USD",
          },
        },
        {
          instrumentId: two.id,
          quote: {
            symbol: "B",
            price: "2.65",
            change: null,
            changePct: null,
            asOf,
            currency: "USD",
          },
        },
      ]);
      await store.upsertQuotes([
        {
          instrumentId: one.id,
          quote: {
            symbol: "A",
            price: "710",
            change: "1",
            changePct: "0.001",
            asOf: new Date("2026-09-24T20:00:00.000Z"),
            currency: "USD",
          },
        },
      ]);

      const rows = must(
        await admin
          .from("quotes_latest")
          .select("instrument_id, price, change, change_pct, as_of")
          .in("instrument_id", [one.id, two.id]),
        "cotizaciones",
      );
      const byId = new Map(rows.map((r) => [r.instrument_id, r]));
      expect(byId.get(one.id)).toMatchObject({
        price: 710,
        change: 1,
        change_pct: 0.001,
      });
      expect(new Date(byId.get(one.id)?.as_of ?? "").toISOString()).toBe(
        "2026-09-24T20:00:00.000Z",
      );
      expect(byId.get(two.id)).toMatchObject({
        price: 2.65,
        change: null,
        change_pct: null,
      });
    });
  });

  describe("estado del instrumento", () => {
    it("markBackfilled y markNeedsBackfill", async () => {
      const inst = await newInstrument();
      await store.markBackfilled(inst.id, {
        at: new Date("2026-09-24T22:00:00Z"),
        from: "2021-09-24",
      });
      let row = must(
        await admin
          .from("instruments")
          .select("history_backfilled_at, history_from")
          .eq("id", inst.id)
          .single(),
        "instrumento",
      );
      expect(row.history_from).toBe("2021-09-24");
      expect(new Date(row.history_backfilled_at ?? "").toISOString()).toBe(
        "2026-09-24T22:00:00.000Z",
      );

      await store.markNeedsBackfill(inst.id);
      row = must(
        await admin
          .from("instruments")
          .select("history_backfilled_at, history_from")
          .eq("id", inst.id)
          .single(),
        "instrumento",
      );
      expect(row.history_backfilled_at).toBeNull();
      expect(row.history_from).toBe("2021-09-24"); // se conserva: el re-backfill arranca desde ahí
    });

    it("fillProfileGaps completa solo los campos vacíos y no pisa los existentes", async () => {
      const inst = await newInstrument({ name: "Nombre propio", type: null });
      const profile = {
        symbol: inst.symbol,
        name: "Nombre de Yahoo",
        type: "ETF" as const,
        exchange: "NYSEArca",
        currency: "USD",
        sector: "Tech",
        industry: null,
      };

      await store.fillProfileGaps(inst.id, profile);
      await store.fillProfileGaps(inst.id, {
        ...profile,
        exchange: "OTRA",
        sector: "Otro",
        industry: "Soft",
      });

      const row = must(
        await admin
          .from("instruments")
          .select("name, type, exchange, sector, industry")
          .eq("id", inst.id)
          .single(),
        "instrumento",
      );
      expect(row).toEqual({
        name: "Nombre propio", // no se pisa
        type: "ETF",
        exchange: "NYSEArca", // la segunda llamada no lo cambia
        sector: "Tech",
        industry: "Soft", // estaba vacío en la primera y se completa en la segunda
      });
    });

    it("fillProfileGaps con un instrumento inexistente falla con un error claro", async () => {
      await expect(
        store.fillProfileGaps("00000000-0000-0000-0000-000000000000", {
          symbol: "X",
          name: "x",
          type: null,
          exchange: null,
          currency: null,
          sector: null,
          industry: null,
        }),
      ).rejects.toThrow(/db fillProfileGaps/);
    });
  });

  describe("registro de corridas", () => {
    it("abre, cierra y guarda el resumen y los errores como jsonb", async () => {
      const started = new Date("2026-09-24T22:00:00.000Z");
      const id = await store.startRun("daily-prices", started);
      runIds.push(id);

      let row = must(
        await admin.from("market_job_runs").select("*").eq("id", id).single(),
        "corrida",
      );
      expect(row).toMatchObject({
        job: "daily-prices",
        status: "running",
        finished_at: null,
      });
      expect(new Date(row.started_at).toISOString()).toBe(
        started.toISOString(),
      );

      const summary = {
        job: "daily-prices" as const,
        provider: "fake",
        instruments: 2,
        backfilled: 1,
        rebackfilled: 0,
        incremental: 1,
        failed: 0,
        skippedForBudget: 0,
        barsWritten: 10,
        droppedBars: 1,
        actionsWritten: 0,
        quotesUpdated: 2,
      };
      await store.finishRun(id, {
        status: "partial",
        finishedAt: new Date("2026-09-24T22:01:00.000Z"),
        summary,
        issues: [{ stage: "quotes", symbol: "ZZ", message: "sin cotización" }],
      });

      row = must(
        await admin.from("market_job_runs").select("*").eq("id", id).single(),
        "corrida",
      );
      expect(row.status).toBe("partial");
      expect(new Date(row.finished_at ?? "").toISOString()).toBe(
        "2026-09-24T22:01:00.000Z",
      );
      expect(row.summary).toEqual(summary);
      expect(row.errors).toEqual([
        { stage: "quotes", symbol: "ZZ", message: "sin cotización" },
      ]);
    });

    it("failStaleRuns cierra como 'error' solo las que llevan más de 15 minutos", async () => {
      const now = new Date("2026-09-24T22:00:00.000Z");
      const stale = await store.startRun(
        "backfill",
        new Date(now.getTime() - 20 * 60_000),
      );
      const fresh = await store.startRun(
        "backfill",
        new Date(now.getTime() - 5 * 60_000),
      );
      runIds.push(stale, fresh);

      const closed = await store.failStaleRuns(
        new Date(now.getTime() - 15 * 60_000),
        now,
      );

      expect(closed).toBeGreaterThanOrEqual(1);
      const rows = must(
        await admin
          .from("market_job_runs")
          .select("id, status, finished_at, errors")
          .in("id", [stale, fresh]),
        "corridas",
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(stale)).toMatchObject({ status: "error" });
      expect(new Date(byId.get(stale)?.finished_at ?? "").toISOString()).toBe(
        now.toISOString(),
      );
      expect(byId.get(fresh)).toMatchObject({
        status: "running",
        finished_at: null,
      });
    });

    it("la base rechaza un estado o un job inválido y una corrida terminada sin fecha de fin", async () => {
      const bad = async (row: Record<string, unknown>) =>
        (await admin.from("market_job_runs").insert(row as never)).error?.code;
      expect(await bad({ job: "otro" })).toBe("23514");
      expect(
        await bad({
          job: "daily-prices",
          status: "raro",
          finished_at: new Date().toISOString(),
        }),
      ).toBe("23514");
      expect(await bad({ job: "daily-prices", status: "ok" })).toBe("23514"); // ok sin finished_at
      expect(
        await bad({
          job: "daily-prices",
          status: "running",
          finished_at: new Date().toISOString(),
        }),
      ).toBe("23514");
    });
  });

  describe("runMarketJob contra la base real (mercado falso, sin Yahoo)", () => {
    const NOW = new Date("2026-09-24T22:00:00.000Z");

    it("backfill, corrida idempotente y reajuste por split: lo guardado siempre es lo que informa el proveedor", async () => {
      const inst = await newInstrument();
      await addTx(a, aAccountId, inst.id, "2026-03-09T15:00:00Z");
      const market = new FakeMarket();
      market.addSeries(inst.symbol, "2026-01-01", "2026-09-23");
      const run = async () => {
        const result = await runMarketJob({
          job: "daily-prices",
          provider: market,
          store: scoped([inst.id]),
          now: NOW,
        });
        if (result.runId) runIds.push(result.runId);
        return result;
      };
      const expected = () =>
        market.snapshot(inst.symbol).filter((r) => r.date >= "2026-03-02");

      // 1) Backfill inicial desde la primera transacción menos 7 días.
      const first = await run();
      expect(first.status).toBe("ok");
      expect(first.summary).toMatchObject({ backfilled: 1, quotesUpdated: 1 });
      expect(await dbPrices(inst.id)).toEqual(expected());
      const meta = must(
        await admin
          .from("instruments")
          .select("history_from, history_backfilled_at, name, sector")
          .eq("id", inst.id)
          .single(),
        "instrumento",
      );
      expect(meta.history_from).toBe("2026-03-02");
      expect(meta.history_backfilled_at).not.toBeNull();
      expect(meta.name).toBe("Instrumento de prueba"); // el perfil no pisa lo que ya había
      expect(meta.sector).toBe("Tech"); // y completa lo vacío
      expect(
        must(
          await admin
            .from("quotes_latest")
            .select("price")
            .eq("instrument_id", inst.id)
            .single(),
          "cotización",
        ).price,
      ).toBe(100);

      // 2) Segunda corrida: incremental, sin cambios.
      const second = await run();
      expect(second.summary).toMatchObject({
        backfilled: 0,
        incremental: 1,
        rebackfilled: 0,
      });
      expect(await dbPrices(inst.id)).toEqual(expected());

      // 3) Split 10:1 con fecha ex nueva: los cierres previos quedan divididos por 10 y una rueda
      //    que Yahoo dejó de devolver se poda.
      market.addBar(inst.symbol, "2026-09-24", "15");
      market.split(inst.symbol, "2026-09-24", 10);
      market.deleteBar(inst.symbol, "2026-06-15");
      const third = await run();
      expect(third.status).toBe("ok");
      expect(third.summary).toMatchObject({ rebackfilled: 1, incremental: 0 });
      expect(await dbPrices(inst.id)).toEqual(expected());
      expect(
        (await dbPrices(inst.id)).some((r) => r.date === "2026-06-15"),
      ).toBe(false);
      const actions = must(
        await admin
          .from("corporate_actions")
          .select("type, ex_date, ratio")
          .eq("instrument_id", inst.id),
        "acciones",
      );
      expect(actions).toEqual([
        { type: "SPLIT", ex_date: "2026-09-24", ratio: 10 },
      ]);

      // 4) Todo quedó registrado.
      const runs = must(
        await admin
          .from("market_job_runs")
          .select("status, finished_at")
          .in("id", runIds.slice(-3)),
        "corridas",
      );
      expect(runs.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
      expect(runs.every((r) => r.finished_at !== null)).toBe(true);
    });
  });
});
