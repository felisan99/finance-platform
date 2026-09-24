import { describe, expect, it, vi } from "vitest";
import {
  MarketDataError,
  type InstrumentProfile,
  type MarketDataProvider,
  type Quote,
} from "@/lib/market-data";
import {
  MAX_NEW_INSTRUMENTS,
  ensureInstruments,
  resolveNewInstrument,
} from "../instruments";

/** Cliente admin falso con `instruments` en memoria: upsert con ignoreDuplicates y select por símbolos. */
function fakeAdmin(
  initial: Array<{ id: string; symbol: string }> = [],
  failOn?: "upsert" | "select",
) {
  const table = [...initial];
  const calls = {
    upserts: [] as Array<{ rows: unknown[]; options: unknown }>,
    selects: [] as string[][],
  };
  const admin = {
    from: (name: string) => {
      if (name !== "instruments") throw new Error(`tabla inesperada: ${name}`);
      return {
        upsert: async (rows: Array<{ symbol: string }>, options: unknown) => {
          calls.upserts.push({ rows, options });
          if (failOn === "upsert") return { error: { message: "boom" } };
          for (const row of rows) {
            if (!table.some((t) => t.symbol === row.symbol))
              table.push({ id: `id-${row.symbol}`, symbol: row.symbol });
          }
          return { error: null };
        },
        select: () => ({
          in: async (_column: string, symbols: string[]) => {
            calls.selects.push(symbols);
            if (failOn === "select")
              return { data: null, error: { message: "boom" } };
            return {
              data: table.filter((t) => symbols.includes(t.symbol)),
              error: null,
            };
          },
        }),
      };
    },
  };
  return { admin: admin as never, calls, table };
}

const inst = (
  symbol: string,
  name: string | null = `${symbol} Inc.`,
  type: "STOCK" | "ETF" = "STOCK",
) => ({ symbol, name, type });

describe("ensureInstruments", () => {
  it("crea los que faltan y devuelve el id de todos (nuevos y existentes)", async () => {
    const { admin, calls } = fakeAdmin([{ id: "id-VOO", symbol: "VOO" }]);
    const ids = await ensureInstruments(admin, [
      inst("VOO", "Vanguard", "ETF"),
      inst("DDOG"),
    ]);
    expect(ids).toEqual(
      new Map([
        ["VOO", "id-VOO"],
        ["DDOG", "id-DDOG"],
      ]),
    );
    // Los existentes no se pisan: ignoreDuplicates.
    expect(calls.upserts[0]?.options).toEqual({
      onConflict: "symbol",
      ignoreDuplicates: true,
    });
  });

  it("deduplica símbolos repetidos y conserva el primero", async () => {
    const { admin, calls } = fakeAdmin();
    await ensureInstruments(admin, [
      inst("AAA", "Primero"),
      inst("AAA", "Segundo"),
    ]);
    expect(calls.upserts[0]?.rows).toEqual([
      { symbol: "AAA", name: "Primero", type: "STOCK" },
    ]);
  });

  it("limpia el nombre (controles y largo)", async () => {
    const { admin, calls } = fakeAdmin();
    await ensureInstruments(admin, [
      inst("AAA", `  Nombre\u0000 raro\n${"x".repeat(300)}`),
    ]);
    const name = (calls.upserts[0]?.rows[0] as { name: string }).name;
    expect(name.startsWith("Nombre raro x")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(120);
  });

  it.each([
    "",
    "voo",
    "V O",
    "V@O",
    "A".repeat(16),
    "-A",
    "A-",
    "A--B",
    "A;DROP",
    "<b>",
    "^GSPC",
    "A.B",
  ])("rechaza el símbolo %j sin tocar la base", async (symbol) => {
    const { admin, calls } = fakeAdmin();
    await expect(ensureInstruments(admin, [inst(symbol)])).rejects.toThrow(
      /Símbolo inválido/,
    );
    expect(calls.upserts).toHaveLength(0);
  });

  it("acepta clases de acciones con guion", async () => {
    const { admin } = fakeAdmin();
    expect(await ensureInstruments(admin, [inst("BRK-B")])).toEqual(
      new Map([["BRK-B", "id-BRK-B"]]),
    );
  });

  it("un tope de instrumentos nuevos por llamada", async () => {
    const { admin, calls } = fakeAdmin();
    const many = Array.from({ length: MAX_NEW_INSTRUMENTS + 1 }, (_, i) =>
      inst(`S${i}`),
    );
    await expect(ensureInstruments(admin, many)).rejects.toThrow(
      /Demasiados instrumentos/,
    );
    expect(calls.upserts).toHaveLength(0);
    const ok = many.slice(0, MAX_NEW_INSTRUMENTS);
    expect((await ensureInstruments(admin, ok)).size).toBe(MAX_NEW_INSTRUMENTS);
  });

  it("lee los ids en grupos de 100 (una URL larga se rechaza)", async () => {
    const { admin, calls } = fakeAdmin();
    await ensureInstruments(
      admin,
      Array.from({ length: 150 }, (_, i) => inst(`S${i}`)),
    );
    expect(calls.selects.map((g) => g.length)).toEqual([100, 50]);
  });

  it("una lista vacía no consulta nada", async () => {
    const { admin, calls } = fakeAdmin();
    expect(await ensureInstruments(admin, [])).toEqual(new Map());
    expect(calls.upserts).toHaveLength(0);
  });

  it("propaga los errores de la base con contexto", async () => {
    await expect(
      ensureInstruments(fakeAdmin([], "upsert").admin, [inst("AAA")]),
    ).rejects.toThrow("db ensureInstruments: boom");
    await expect(
      ensureInstruments(fakeAdmin([], "select").admin, [inst("AAA")]),
    ).rejects.toThrow("db ensureInstruments: boom");
  });
});

/** Proveedor falso: cotizaciones y perfiles por símbolo. */
function provider(
  options: {
    quotes?: Record<string, Partial<Quote> | null>;
    profiles?: Record<string, Partial<InstrumentProfile>>;
    quotesError?: Error;
    noProfile?: boolean;
  } = {},
) {
  const getQuotes = vi.fn(async (symbols: string[]) => {
    if (options.quotesError) throw options.quotesError;
    return symbols.flatMap((s) => {
      const q = options.quotes?.[s];
      return q === null || q === undefined
        ? []
        : [
            {
              symbol: s,
              price: "10",
              change: null,
              changePct: null,
              asOf: new Date(),
              currency: "USD",
              ...q,
            },
          ];
    });
  });
  const getProfile = vi.fn(async (symbol: string) => {
    const p = options.profiles?.[symbol];
    if (!p) throw new MarketDataError("NOT_FOUND", "no existe", { symbol });
    return {
      symbol,
      name: `${symbol} Inc.`,
      type: "STOCK",
      exchange: "NasdaqGS",
      currency: "USD",
      sector: null,
      industry: null,
      ...p,
    } as InstrumentProfile;
  });
  const base = {
    name: "fake",
    search: async () => [],
    getDailyHistory: async () => ({ bars: [], actions: [], droppedBars: 0 }),
    getQuotes,
  };
  return {
    provider: (options.noProfile
      ? base
      : { ...base, getProfile }) as MarketDataProvider,
    getQuotes,
    getProfile,
  };
}

describe("resolveNewInstrument", () => {
  it("un símbolo que existe, cotiza en USD y es acción o ETF", async () => {
    const { provider: p } = provider({
      quotes: { DDOG: {} },
      profiles: { DDOG: { name: "Datadog, Inc." } },
    });
    expect(await resolveNewInstrument(p, "DDOG")).toEqual({
      ok: true,
      instrument: { symbol: "DDOG", name: "Datadog, Inc.", type: "STOCK" },
    });
    const etf = provider({
      quotes: { VOO: {} },
      profiles: { VOO: { type: "ETF", name: "Vanguard S&P 500 ETF" } },
    });
    expect(await resolveNewInstrument(etf.provider, "VOO")).toMatchObject({
      ok: true,
      instrument: { type: "ETF" },
    });
  });

  it("un símbolo que Yahoo no conoce: NOT_FOUND (no se crea)", async () => {
    const { provider: p } = provider({ quotes: {} });
    expect(await resolveNewInstrument(p, "ZZZZ")).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("el proveedor devuelve otro símbolo distinto al pedido: NOT_FOUND", async () => {
    const { provider: p } = provider({ quotes: { AAA: { symbol: "AAAB" } } });
    expect(await resolveNewInstrument(p, "AAA")).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("símbolo con formato inválido: no consulta al proveedor", async () => {
    const { provider: p, getQuotes } = provider();
    expect(await resolveNewInstrument(p, "v@o")).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it("solo USD: una cotización o un perfil en otra moneda se rechazan", async () => {
    const a = provider({
      quotes: { AAA: { currency: "EUR" } },
      profiles: { AAA: {} },
    });
    expect(await resolveNewInstrument(a.provider, "AAA")).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED",
      message: expect.stringMatching(/USD/),
    });
    const b = provider({
      quotes: { BBB: {} },
      profiles: { BBB: { currency: "CAD" } },
    });
    expect(await resolveNewInstrument(b.provider, "BBB")).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED",
    });
  });

  it("solo acciones y ETFs: un fondo común o un índice (tipo desconocido) se rechazan", async () => {
    const { provider: p } = provider({
      quotes: { VTSAX: {} },
      profiles: { VTSAX: { type: null } },
    });
    expect(await resolveNewInstrument(p, "VTSAX")).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED",
      message: expect.stringMatching(/acciones y ETFs/),
    });
  });

  it("un proveedor sin perfil no puede confirmar el tipo: se rechaza", async () => {
    const { provider: p } = provider({ quotes: { AAA: {} }, noProfile: true });
    expect(await resolveNewInstrument(p, "AAA")).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED",
    });
  });

  it("si Yahoo falla (caído, límite): UNAVAILABLE con un mensaje amable, sin filtrar el error", async () => {
    const { provider: p } = provider({
      quotesError: new MarketDataError("UNAVAILABLE", "HTML con token=abc", {
        symbol: "AAA",
      }),
    });
    const result = await resolveNewInstrument(p, "AAA");
    expect(result).toMatchObject({ ok: false, reason: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("abc");
  });

  it("un NOT_FOUND que viene como error del proveedor también es NOT_FOUND", async () => {
    const { provider: p } = provider({
      quotesError: new MarketDataError("NOT_FOUND", "x"),
    });
    expect(await resolveNewInstrument(p, "ZZZZ")).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
  });
});
