import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyData } from "@/lib/market-data";
import type { InstrumentRow } from "../rows";
import type { RangeInputPoint } from "../range-chart";

// `range-data.ts` junta lecturas (base y Yahoo con caché de Next). Acá se simulan las dos para probar
// lo que decide: de dónde sale el rango de 52 semanas y el respaldo a cierres diarios.

const mocks = vi.hoisted(() => ({
  loadCompanyData: vi.fn(),
  loadIntraday: vi.fn(),
  getPriceSeries: vi.fn(),
  getWatchlistMarket: vi.fn(),
}));

vi.mock("../company-data", () => ({
  kindOf: (i: { type: string | null }) => (i.type === "ETF" ? "etf" : "stock"),
  providerSymbolOf: (i: { symbol: string; provider_symbol: string | null }) =>
    i.provider_symbol ?? i.symbol,
  loadCompanyData: mocks.loadCompanyData,
  loadIntraday: mocks.loadIntraday,
  orNullAfter: <T>(promise: Promise<T>) => promise,
}));
vi.mock("../queries", () => ({
  getPriceSeries: mocks.getPriceSeries,
  getWatchlistMarket: mocks.getWatchlistMarket,
}));

import { loadIntradayRange, loadWeek52, loadYearSeries } from "../range-data";

const NOW = new Date("2026-09-25T20:30:00.000Z");
const client = {} as never;
const instrument: InstrumentRow = {
  id: "i-1",
  symbol: "AAPL",
  name: "Apple Inc.",
  type: "STOCK",
  exchange: null,
  sector: null,
  provider_symbol: null,
};
const company = (low: string | null, high: string | null): CompanyData =>
  ({ fiftyTwoWeekLow: low, fiftyTwoWeekHigh: high }) as CompanyData;

const daily = (days: string[]) =>
  days.map((date, i) => ({ date, close: String(100 + i) }));
const intraday = (days: string[]): RangeInputPoint[] =>
  days.flatMap((day, i) => [
    { label: `${day} 13:30`, day, close: String(100 + i) },
    { label: `${day} 14:00`, day, close: String(100.5 + i) },
  ]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.loadCompanyData.mockResolvedValue(company("90", "130"));
  mocks.getWatchlistMarket.mockResolvedValue([
    { low_close: "95", high_close: "120" },
  ]);
});

describe("loadWeek52", () => {
  it("usa el rango del proveedor cuando viene", async () => {
    expect(
      await loadWeek52(client, instrument, company("90", "130"), NOW),
    ).toEqual({ low: "90", high: "130" });
    expect(mocks.getWatchlistMarket).not.toHaveBeenCalled();
  });

  it("sin datos de la empresa (Yahoo falló o tardó) usa los cierres guardados", async () => {
    expect(await loadWeek52(client, instrument, null, NOW)).toEqual({
      low: "95",
      high: "120",
    });
    // Pide 365 días hacia atrás desde hoy y, como el RPC `watchlist_market` (`p_points >= 2`),
    // al menos 2 puntos: con 1 la base responde «parámetros inválidos».
    expect(mocks.getWatchlistMarket).toHaveBeenCalledWith(
      client,
      ["i-1"],
      "2025-09-25",
      expect.any(Number),
    );
    expect(mocks.getWatchlistMarket.mock.calls[0]![3]).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("si la lectura de respaldo falla, el gráfico igual se dibuja (sin líneas de 52 semanas)", async () => {
    mocks.getWatchlistMarket.mockRejectedValue(
      new Error("db watchlist_market: parámetros inválidos"),
    );
    expect(await loadWeek52(client, instrument, null, NOW)).toEqual({
      low: null,
      high: null,
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("con un solo extremo del proveedor también cae a los cierres (no mezcla fuentes)", async () => {
    expect(
      await loadWeek52(client, instrument, company("90", null), NOW),
    ).toEqual({ low: "95", high: "120" });
  });

  it("sin nada de ninguna fuente, sin rango", async () => {
    mocks.getWatchlistMarket.mockResolvedValue([]);
    expect(await loadWeek52(client, instrument, null, NOW)).toEqual({
      low: null,
      high: null,
    });
  });
});

describe("loadYearSeries", () => {
  it("arma el año con la cotización de hoy al final si todavía no hay cierre de hoy", async () => {
    mocks.getPriceSeries.mockResolvedValue(daily(["2026-09-23", "2026-09-24"]));
    const series = await loadYearSeries({
      client,
      instrument,
      price: {
        price: (await import("@/lib/engine")).d("110"),
        asOf: new Date("2026-09-25T17:00:00.000Z"),
        source: "quote",
      },
      week52: { low: "90", high: "130" },
      now: NOW,
    });
    expect(series!.range).toBe("1y");
    expect(series!.points.map((p) => p.close)).toEqual([100, 101, 110]);
    expect(mocks.getPriceSeries).toHaveBeenCalledWith(
      client,
      "i-1",
      "2025-09-25",
    );
  });

  it("sin historial no hay serie", async () => {
    mocks.getPriceSeries.mockResolvedValue([]);
    expect(
      await loadYearSeries({
        client,
        instrument,
        price: null,
        week52: { low: null, high: null },
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("loadIntradayRange", () => {
  const args = { client, instrument, range: "1w" as const, now: NOW };

  it("con barras del día devuelve la serie sin aviso", async () => {
    mocks.loadIntraday.mockResolvedValue(
      intraday(["2026-09-24", "2026-09-25"]),
    );
    const result = await loadIntradayRange(args);
    expect(result).toMatchObject({ ok: true, notice: null });
    if (result.ok) {
      expect(result.series.source).toBe("intraday");
      expect(result.series.points).toHaveLength(4);
    }
    expect(mocks.getPriceSeries).not.toHaveBeenCalled();
  });

  it("la semana y el mes piden a Yahoo con el símbolo del proveedor", async () => {
    mocks.loadIntraday.mockResolvedValue(
      intraday(["2026-09-24", "2026-09-25"]),
    );
    await loadIntradayRange({
      ...args,
      instrument: { ...instrument, provider_symbol: "BRK-B" },
      range: "1m",
    });
    expect(mocks.loadIntraday).toHaveBeenCalledWith("BRK-B", "1m");
  });

  it("si Yahoo falla cae a los cierres diarios y lo avisa", async () => {
    mocks.loadIntraday.mockRejectedValue(new Error("caído"));
    mocks.getPriceSeries.mockResolvedValue(
      daily([
        "2026-08-20",
        "2026-09-14",
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
      ]),
    );
    const result = await loadIntradayRange(args);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.series.source).toBe("daily");
      // La semana: solo los últimos 7 días corridos del último dato (24/09 → desde el 18/09).
      expect(result.series.points).toHaveLength(4);
      expect(result.notice).toMatch(/cierres diarios/);
    }
    expect(mocks.getPriceSeries).toHaveBeenCalledWith(
      client,
      "i-1",
      "2026-08-16", // 40 días antes de hoy
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("si Yahoo responde vacío también cae a los cierres", async () => {
    mocks.loadIntraday.mockResolvedValue([]);
    mocks.getPriceSeries.mockResolvedValue(daily(["2026-09-23", "2026-09-24"]));
    const result = await loadIntradayRange(args);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.series.source).toBe("daily");
  });

  it("sin barras ni cierres: error con mensaje, no un gráfico vacío", async () => {
    mocks.loadIntraday.mockRejectedValue(new Error("caído"));
    mocks.getPriceSeries.mockResolvedValue([]);
    expect(await loadIntradayRange(args)).toEqual({
      ok: false,
      message: "Todavía no hay datos suficientes para este rango.",
    });
  });

  it("el rango de 52 semanas del proveedor se pasa a la serie", async () => {
    mocks.loadIntraday.mockResolvedValue(
      intraday(["2026-09-24", "2026-09-25"]),
    );
    const result = await loadIntradayRange(args);
    if (!result.ok) throw new Error("debería andar");
    expect(result.series.week52).toMatchObject({ low: 90, high: 130 });
  });

  it("los datos de la empresa que no llegan no frenan el gráfico", async () => {
    mocks.loadCompanyData.mockResolvedValue(null);
    mocks.loadIntraday.mockResolvedValue(
      intraday(["2026-09-24", "2026-09-25"]),
    );
    const result = await loadIntradayRange(args);
    if (!result.ok) throw new Error("debería andar");
    // Cae al rango de los cierres guardados.
    expect(result.series.week52).toMatchObject({ low: 95, high: 120 });
  });
});
