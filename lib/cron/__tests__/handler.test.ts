import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketDataError } from "@/lib/market-data";
import { FakeMarket, MemoryStore } from "@/lib/market-jobs/__tests__/memory";
import { handleCronRequest, type CronDeps } from "../handler";

const SECRET =
  "c0ffee00d15ea5e0b5e55edc0ffee00d15ea5e0b5e55edc0ffee00d15ea5e0b5";
const NOW = new Date("2026-09-24T22:00:00.000Z");

function setup() {
  const market = new FakeMarket();
  const store = new MemoryStore();
  const getProvider = vi.fn(async () => market);
  const getStore = vi.fn(() => store);
  const deps: CronDeps = {
    secret: SECRET,
    now: () => NOW,
    getProvider,
    getStore,
  };
  const call = (
    headers: Record<string, string> = {},
    job: "daily-prices" | "backfill" = "daily-prices",
    extra: CronDeps = {},
  ) =>
    handleCronRequest(
      new Request("http://localhost/api/cron/x", { headers }),
      job,
      { ...deps, ...extra },
    );
  const authed = { authorization: `Bearer ${SECRET}` };
  return { market, store, getProvider, getStore, call, authed };
}

afterEach(() => vi.restoreAllMocks());

describe("handleCronRequest: autorización", () => {
  it.each([
    ["sin cabecera", {}],
    ["token incorrecto", { authorization: `Bearer ${"0".repeat(64)}` }],
    ["esquema incorrecto", { authorization: `Basic ${SECRET}` }],
  ])("401 %s, sin tocar el proveedor ni la base", async (_label, headers) => {
    const { call, getProvider, getStore, store } = setup();
    const response = await call(headers);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(getProvider).not.toHaveBeenCalled();
    expect(getStore).not.toHaveBeenCalled();
    expect(store.runs).toEqual([]);
  });

  it("500 y cerrado si CRON_SECRET no está configurado (aunque se mande un bearer)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { call, getProvider, getStore } = setup();
    const response = await call(
      { authorization: "Bearer lo-que-sea" },
      "daily-prices",
      { secret: undefined },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "misconfigured" });
    expect(getProvider).not.toHaveBeenCalled();
    expect(getStore).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });

  it("500 y cerrado si el secreto es demasiado corto", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { call } = setup();
    const response = await call(
      { authorization: "Bearer corto" },
      "daily-prices",
      { secret: "corto" },
    );
    expect(response.status).toBe(500);
  });

  it("nunca loguea el secreto ni el token recibido", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { call } = setup();
    await call(
      { authorization: "Bearer token-secreto-recibido" },
      "daily-prices",
      { secret: undefined },
    );
    await call({ authorization: "Bearer token-secreto-recibido" });
    const logged = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
    expect(logged).not.toContain("token-secreto-recibido");
    expect(logged).not.toContain(SECRET);
  });
});

describe("handleCronRequest: corrida", () => {
  it("200 con estado y contadores; sin caché", async () => {
    const { market, store, call, authed } = setup();
    market.addSeries("VOO", "2026-01-01", "2026-09-23");
    store.addInstrument("VOO", { firstTxDate: "2026-03-09" });

    const response = await call(authed);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "ok",
      runId: "run-1",
      issues: 0,
      summary: {
        job: "daily-prices",
        instruments: 1,
        backfilled: 1,
        quotesUpdated: 1,
      },
    });
    expect(store.closesOf("VOO").length).toBeGreaterThan(0);
  });

  it("le pasa al job el nombre y el 'ahora' inyectado", async () => {
    const { store, call, authed } = setup();
    await call(authed, "backfill");
    expect(store.runs[0]).toMatchObject({ job: "backfill", startedAt: NOW });
  });

  it("una corrida parcial responde 200; el detalle queda en la base, no en la respuesta", async () => {
    const { market, store, call, authed } = setup();
    for (const s of ["AAA", "BBB"]) {
      market.addSeries(s, "2026-01-01", "2026-09-23");
      store.addInstrument(s, { firstTxDate: "2026-03-09" });
    }
    market.failHistory(
      "BBB",
      new MarketDataError("UNAVAILABLE", "HTML con token=abc123", {
        symbol: "BBB",
      }),
    );

    const response = await call(authed);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ status: "partial", issues: 1 });
    expect(text).not.toContain("abc123");
    expect(store.runs[0]?.finished?.issues[0]?.symbol).toBe("BBB");
  });

  it("si la corrida falla entera responde 500 (los logs de Vercel la marcan como fallo)", async () => {
    const { market, store, call, authed } = setup();
    market.failHistory("AAA");
    store.addInstrument("AAA", { firstTxDate: "2026-03-09" });
    const response = await call(authed);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      status: "error",
      issues: expect.any(Number),
    });
  });

  it("si no se puede armar el proveedor: 500 genérico, sin filtrar el motivo", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { call, authed } = setup();
    const response = await call(authed, "daily-prices", {
      getProvider: async () => {
        throw new Error("MARKET_DATA_PROVIDER inválido con datos internos");
      },
    });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(JSON.stringify({ error: "internal" }));
    expect(error).toHaveBeenCalled();
  });

  it("si no se puede armar el cliente de la base: 500 genérico", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { call, authed } = setup();
    const response = await call(authed, "daily-prices", {
      getStore: () => {
        throw new Error("falta SUPABASE_SECRET_KEY");
      },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
  });
});
