import { beforeEach, describe, expect, it, vi } from "vitest";

// La Server Action del precio de referencia (alta de una operación): sesión, símbolo, límite de uso,
// consulta a Yahoo y errores genéricos hacia afuera. Se simulan la sesión, la base y el proveedor.

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  takeRateLimit: vi.fn(),
  getProviderSymbol: vi.fn(),
  getQuotes: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ tag: "db" }),
}));
vi.mock("@/lib/db/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/db/rate-limit", () => ({ takeRateLimit: mocks.takeRateLimit }));
vi.mock("@/lib/portfolio/queries", () => ({
  getInstruments: vi.fn(),
  getPrimaryAccount: vi.fn(),
  getTransactionRows: vi.fn(),
  getProviderSymbol: mocks.getProviderSymbol,
}));
vi.mock("@/lib/portfolio/background", () => ({
  backfillPendingInBackground: () => {},
}));
vi.mock("@/lib/portfolio/instruments", () => ({
  resolveInstrumentId: vi.fn(),
}));
vi.mock("@/lib/market-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/market-data")>()),
  getMarketDataProvider: async () => ({ getQuotes: mocks.getQuotes }),
}));

import { getReferencePrice } from "@/app/(app)/activity/actions";
import { MarketDataError } from "@/lib/market-data";

const quote = (overrides: Record<string, unknown> = {}) => ({
  symbol: "VOO",
  price: "575.24",
  asOf: new Date("2026-09-25T20:00:00.000Z"),
  currency: "USD",
  change: null,
  changePct: null,
  ...overrides,
});
const plain = (value: string) => value.replace(/[  ]/g, " ");

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSessionUser.mockResolvedValue({ id: "u-1" });
  mocks.takeRateLimit.mockResolvedValue(true);
  mocks.getProviderSymbol.mockResolvedValue(null);
  mocks.getQuotes.mockResolvedValue([quote()]);
});

describe("getReferencePrice", () => {
  it("devuelve el precio listo para el formulario, con su texto y su hora de Montevideo", async () => {
    const result = await getReferencePrice("voo");
    expect(result).toEqual({
      ok: true,
      symbol: "VOO",
      price: "575.24",
      priceText: "US$ 575,24",
      asOfText: "25/09/2026 17:00",
    });
    expect(mocks.getQuotes).toHaveBeenCalledWith(["VOO"]);
    expect(mocks.takeRateLimit).toHaveBeenCalledWith(
      { tag: "db" },
      "search_symbols",
    );
  });

  it("sin sesión avisa y no consulta nada", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect(await getReferencePrice("VOO")).toEqual({
      ok: false,
      message: "La sesión venció. Volvé a ingresar.",
    });
    expect(mocks.getQuotes).not.toHaveBeenCalled();
    expect(mocks.takeRateLimit).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "../x", "a".repeat(16), "VOO;DROP", "€", "A B C"])(
    "el símbolo «%s» se rechaza antes de gastar un uso o llamar a Yahoo",
    async (symbol) => {
      const result = await getReferencePrice(symbol);
      // «A B C» se normaliza a A-B-C (válido): ese sí consulta.
      if (symbol === "A B C") {
        expect(mocks.getQuotes).toHaveBeenCalledWith(["A-B-C"]);
        return;
      }
      expect(result).toEqual({
        ok: false,
        message: "Revisá el símbolo: no parece válido.",
      });
      expect(mocks.getQuotes).not.toHaveBeenCalled();
      expect(mocks.takeRateLimit).not.toHaveBeenCalled();
    },
  );

  it("un valor que no es texto no rompe la acción", async () => {
    expect(
      await getReferencePrice(undefined as unknown as string),
    ).toMatchObject({
      ok: false,
    });
    expect(await getReferencePrice(42 as unknown as string)).toMatchObject({
      ok: false,
    });
    expect(mocks.getQuotes).not.toHaveBeenCalled();
  });

  it("«brk.b» se normaliza a BRK-B", async () => {
    mocks.getQuotes.mockResolvedValue([quote({ symbol: "BRK-B" })]);
    const result = await getReferencePrice("brk.b");
    expect(result).toMatchObject({ ok: true, symbol: "BRK-B" });
    expect(mocks.getQuotes).toHaveBeenCalledWith(["BRK-B"]);
  });

  it("un instrumento con símbolo propio del proveedor se consulta con ese", async () => {
    mocks.getProviderSymbol.mockResolvedValue("BF-B");
    mocks.getQuotes.mockResolvedValue([quote({ symbol: "BF-B" })]);
    const result = await getReferencePrice("BFB");
    expect(mocks.getQuotes).toHaveBeenCalledWith(["BF-B"]);
    expect(result).toMatchObject({ ok: true, symbol: "BFB" });
  });

  it("pasado el límite de uso avisa y no llama a Yahoo", async () => {
    mocks.takeRateLimit.mockResolvedValue(false);
    expect(await getReferencePrice("VOO")).toEqual({
      ok: false,
      message: "Muchas consultas seguidas. Esperá un momento.",
    });
    expect(mocks.getQuotes).not.toHaveBeenCalled();
  });

  it.each([
    ["sin cotización", []],
    ["de otro símbolo", [quote({ symbol: "SPY" })]],
    ["en otra moneda", [quote({ currency: "EUR" })]],
    ["con precio no positivo", [quote({ price: "0" })]],
    ["con precio que el formulario no acepta", [quote({ price: "12345678" })]],
  ])(
    "una cotización %s: «No encontramos cotización»",
    async (_name, quotes) => {
      mocks.getQuotes.mockResolvedValue(quotes);
      expect(await getReferencePrice("VOO")).toEqual({
        ok: false,
        message: "No encontramos cotización de VOO.",
      });
    },
  );

  it("un símbolo que Yahoo no conoce (NOT_FOUND) avisa lo mismo, sin ensuciar el log", async () => {
    mocks.getQuotes.mockRejectedValue(new MarketDataError("NOT_FOUND", "x"));
    expect(await getReferencePrice("ZZZZ")).toEqual({
      ok: false,
      message: "No encontramos cotización de ZZZZ.",
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("un corte de Yahoo da un mensaje genérico (sin el detalle) y el detalle va al log", async () => {
    mocks.getQuotes.mockRejectedValue(
      new MarketDataError("UNAVAILABLE", "HTTP 503 desde 10.0.0.7"),
    );
    const result = await getReferencePrice("VOO");
    expect(result).toEqual({
      ok: false,
      message: "No pudimos traer el precio actual ahora. Cargalo a mano.",
    });
    expect(JSON.stringify(result)).not.toContain("10.0.0.7");
    expect(console.error).toHaveBeenCalled();
  });

  it("un pedido inválido al proveedor (BAD_REQUEST) no ensucia el log", async () => {
    mocks.getQuotes.mockRejectedValue(new MarketDataError("BAD_REQUEST", "x"));
    await getReferencePrice("VOO");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("si la base falla al leer el límite no deja pasar sin límite", async () => {
    mocks.takeRateLimit.mockRejectedValue(new Error("db down"));
    expect(await getReferencePrice("VOO")).toMatchObject({ ok: false });
    expect(mocks.getQuotes).not.toHaveBeenCalled();
  });

  it("el texto del precio usa la coma de es-UY", async () => {
    mocks.getQuotes.mockResolvedValue([quote({ price: "1234.5" })]);
    const result = await getReferencePrice("VOO");
    if (!result.ok) throw new Error("debería andar");
    expect(plain(result.priceText)).toBe("US$ 1.234,50");
    expect(result.price).toBe("1234.5");
  });
});
