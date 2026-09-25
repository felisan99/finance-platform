import { describe, expect, it } from "vitest";
import { getMarketDataProvider } from "../config";

// Prueba EN VIVO (`pnpm test:live`): pide a Yahoo real los datos de la empresa y las series
// intradía con el proveedor de verdad, no con uno falso. Yahoo no es una API oficial: esto avisa si
// cambió la forma de las respuestas. No escribe nada en ninguna base.
//
// No se puede afirmar el valor de un dato de mercado (cambia todos los días): se comprueba la forma
// y que sea coherente (rangos ordenados, cifras positivas, series ordenadas).

const provider = await getMarketDataProvider();
const get = provider.getCompanyData!.bind(provider);
const intraday = provider.getIntradaySeries!.bind(provider);

describe("Yahoo real: datos de la empresa", () => {
  it("una acción (GOOGL) trae los datos de la ficha y hasta 4 trimestres de ganancias", async () => {
    const data = await get("GOOGL", "stock");
    expect(data.kind).toBe("stock");
    for (const field of [
      "previousClose",
      "open",
      "dayLow",
      "dayHigh",
      "fiftyTwoWeekLow",
      "fiftyTwoWeekHigh",
      "trailingPE",
      "epsTrailing",
      "priceToBook",
      "bookValue",
    ] as const) {
      expect(data[field], field).toMatch(/^-?\d+(\.\d+)?$/);
    }
    for (const field of [
      "volume",
      "averageVolume",
      "marketCap",
      "sharesOutstanding",
    ] as const) {
      expect(Number.isInteger(data[field]), field).toBe(true);
      expect(data[field], field).toBeGreaterThan(0);
    }
    expect(Number(data.fiftyTwoWeekLow)).toBeLessThan(
      Number(data.fiftyTwoWeekHigh),
    );
    expect(Number(data.dayLow)).toBeLessThanOrEqual(Number(data.dayHigh));

    expect(data.earnings.length).toBeGreaterThan(0);
    expect(data.earnings.length).toBeLessThanOrEqual(4);
    const periods = data.earnings.map((e) => e.periodEnd);
    expect(periods).toEqual([...periods].sort());
    for (const quarter of data.earnings) {
      expect(quarter.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(quarter.epsActual).toMatch(/^-?\d+(\.\d+)?$/);
    }
    expect(data.nextEarningsDate ?? "2000-01-01").toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  }, 60_000);

  it("un ETF (VOO) trae lo suyo y NINGUNA ganancia", async () => {
    const data = await get("VOO", "etf");
    expect(data.kind).toBe("etf");
    expect(data.earnings).toEqual([]);
    expect(data.previousClose).toMatch(/^\d+(\.\d+)?$/);
    expect(data.fiftyTwoWeekHigh).toMatch(/^\d+(\.\d+)?$/);
    expect(data.totalAssets).toBeGreaterThan(0);
    expect(data.dividendYield).toMatch(/^0\.\d+$/);
    expect(data.epsTrailing).toBeNull();
  }, 60_000);

  it("un símbolo que no existe es NOT_FOUND (no un corte)", async () => {
    await expect(get("ZZZZQQ", "stock")).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
  }, 60_000);

  it("getProfile sigue andando con la validación de la librería desactivada", async () => {
    const profile = await provider.getProfile!("GOOGL");
    expect(profile).toMatchObject({ symbol: "GOOGL", type: "STOCK" });
    expect(profile.name).toContain("Alphabet");
    expect(profile.currency).toBe("USD");
    const etf = await provider.getProfile!("VOO");
    expect(etf.type).toBe("ETF");
  }, 60_000);
});

describe("Yahoo real: series intradía", () => {
  it("la semana: barras ordenadas de las últimas 5 ruedas", async () => {
    const points = await intraday("GOOGL", "1w");
    expect(points.length).toBeGreaterThan(30);
    const times = points.map((p) => p.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    for (const point of points) {
      expect(point.close).toMatch(/^\d+(\.\d+)?$/);
      expect(Number(point.close)).toBeGreaterThan(0);
    }
    const days = new Set(points.map((p) => p.at.toISOString().slice(0, 10)));
    expect(days.size).toBeLessThanOrEqual(6); // 5 ruedas (una barra puede caer en el día UTC siguiente)
  }, 60_000);

  it("el mes: más barras que la semana", async () => {
    const [week, month] = await Promise.all([
      intraday("GOOGL", "1w"),
      intraday("GOOGL", "1m"),
    ]);
    expect(month.length).toBeGreaterThan(week.length / 2);
    expect(month.at(-1)!.at.getTime()).toBeGreaterThanOrEqual(
      month[0]!.at.getTime(),
    );
  }, 60_000);
});
