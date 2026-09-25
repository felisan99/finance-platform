import { beforeEach, describe, expect, it, vi } from "vitest";

// La Server Action del gráfico: sesión, validación de lo recibido, límite de uso y errores
// genéricos hacia afuera. Se simulan la base, la sesión y el armado de la serie.

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  takeRateLimit: vi.fn(),
  getInstrumentBySymbol: vi.fn(),
  loadIntradayRange: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ tag: "db" }),
}));
vi.mock("@/lib/db/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/db/rate-limit", () => ({ takeRateLimit: mocks.takeRateLimit }));
vi.mock("@/lib/portfolio/queries", () => ({
  getInstrumentBySymbol: mocks.getInstrumentBySymbol,
}));
vi.mock("@/lib/portfolio/range-data", () => ({
  loadIntradayRange: mocks.loadIntradayRange,
}));

import { getRangeSeries } from "@/app/(app)/positions/[symbol]/actions";

const instrument = { id: "i-1", symbol: "BRK-B" };
const GENERIC =
  "No pudimos traer el gráfico ahora. Probá de nuevo en un momento.";
const served = { ok: true, series: { range: "1w" }, notice: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSessionUser.mockResolvedValue({ id: "u-1" });
  mocks.takeRateLimit.mockResolvedValue(true);
  mocks.getInstrumentBySymbol.mockResolvedValue(instrument);
  mocks.loadIntradayRange.mockResolvedValue(served);
});

describe("getRangeSeries", () => {
  it("sin sesión avisa y no toca nada", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    expect(await getRangeSeries("VOO", "1w")).toEqual({
      ok: false,
      message: "La sesión venció. Volvé a ingresar.",
    });
    expect(mocks.takeRateLimit).not.toHaveBeenCalled();
    expect(mocks.loadIntradayRange).not.toHaveBeenCalled();
  });

  it("atiende la semana y el mes con el instrumento y la hora de ahora", async () => {
    expect(await getRangeSeries("brk.b", "1m")).toEqual(served);
    expect(mocks.getInstrumentBySymbol).toHaveBeenCalledWith(
      { tag: "db" },
      "BRK-B",
    );
    const call = mocks.loadIntradayRange.mock.calls[0]![0];
    expect(call).toMatchObject({ instrument, range: "1m" });
    expect(call.now).toBeInstanceOf(Date);
    expect(mocks.takeRateLimit).toHaveBeenCalledWith(
      { tag: "db" },
      "search_symbols",
    );
  });

  it.each(["1y", "1d", "", "1W", "todo", "__proto__"])(
    "el rango «%s» no es válido: mensaje genérico y ni siquiera se cuenta el uso",
    async (range) => {
      expect(await getRangeSeries("VOO", range)).toEqual({
        ok: false,
        message: GENERIC,
      });
      expect(mocks.takeRateLimit).not.toHaveBeenCalled();
      expect(mocks.getInstrumentBySymbol).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "../etc",
    "a b c d e f g h i j k l m n o p q",
    "VOO;DROP",
    "x".repeat(41),
    "€",
  ])("el símbolo «%s» no es válido", async (symbol) => {
    expect(await getRangeSeries(symbol, "1w")).toEqual({
      ok: false,
      message: GENERIC,
    });
    expect(mocks.getInstrumentBySymbol).not.toHaveBeenCalled();
    expect(mocks.loadIntradayRange).not.toHaveBeenCalled();
  });

  it("un valor que no es texto no rompe la acción", async () => {
    expect(
      await getRangeSeries(
        undefined as unknown as string,
        undefined as unknown as string,
      ),
    ).toEqual({ ok: false, message: GENERIC });
    expect(await getRangeSeries({ a: 1 } as unknown as string, "1w")).toEqual({
      ok: false,
      message: GENERIC,
    });
  });

  it("pasado el límite de uso avisa y no consulta nada", async () => {
    mocks.takeRateLimit.mockResolvedValue(false);
    expect(await getRangeSeries("VOO", "1w")).toEqual({
      ok: false,
      message: "Muchas consultas seguidas. Esperá un momento.",
    });
    expect(mocks.getInstrumentBySymbol).not.toHaveBeenCalled();
    expect(mocks.loadIntradayRange).not.toHaveBeenCalled();
  });

  it("un símbolo que no está en la base no llega a Yahoo", async () => {
    mocks.getInstrumentBySymbol.mockResolvedValue(null);
    expect(await getRangeSeries("ZZZZ", "1w")).toEqual({
      ok: false,
      message: GENERIC,
    });
    expect(mocks.loadIntradayRange).not.toHaveBeenCalled();
  });

  it("un fallo interno da un mensaje genérico y el detalle va al log", async () => {
    mocks.loadIntradayRange.mockRejectedValue(
      new Error("secreto interno: clave=abc"),
    );
    const result = await getRangeSeries("VOO", "1w");
    expect(result).toEqual({ ok: false, message: GENERIC });
    expect(JSON.stringify(result)).not.toContain("secreto");
    expect(console.error).toHaveBeenCalled();
  });

  it("si la base falla al leer el límite, también genérico (nunca deja pasar sin límite)", async () => {
    mocks.takeRateLimit.mockRejectedValue(new Error("db down"));
    expect(await getRangeSeries("VOO", "1w")).toEqual({
      ok: false,
      message: GENERIC,
    });
    expect(mocks.loadIntradayRange).not.toHaveBeenCalled();
  });
});
