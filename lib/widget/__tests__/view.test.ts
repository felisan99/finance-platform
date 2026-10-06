import { describe, expect, it } from "vitest";
import { computeEngine, d, valuePortfolio, type PriceInfo } from "@/lib/engine";
import { buy, deposit } from "@/lib/engine/__tests__/helpers";
import { buildDashboard } from "@/lib/portfolio/dashboard";
import { buildWidgetView, emptyWidgetView } from "../view";

const T = "2026-01-05T15:00:00Z";
const NOW = new Date("2026-10-06T18:30:00Z");

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string | null) =>
  value?.replace(/[\u00a0\u202f]/g, " ") ?? null;

const quote = (price: string, previousClose: string | null): PriceInfo => ({
  price: d(price),
  asOf: new Date("2026-10-05T20:00:00Z"),
  source: "quote",
  previousClose: previousClose === null ? null : d(previousClose),
});

describe("buildWidgetView", () => {
  // 5000 depositados; VOO 10 a 100 y AAA 4 a 50 => efectivo 3800; a 120 y 60 valen 1200 y 240 =>
  // total 5240, ganancia total +240 (4,8%). Día: VOO +20, AAA −4 => +16.
  const transactions = [
    deposit(T, "5000"),
    buy(T, "VOO", "10", "100"),
    buy(T, "AAA", "4", "50"),
  ];
  const valued = (prices: Map<string, PriceInfo>) =>
    valuePortfolio(computeEngine(transactions), prices);

  it("solo textos ya formateados: total, día, ganancia total, posiciones y fecha de precios", () => {
    const view = buildWidgetView(
      buildDashboard(
        valued(
          new Map([
            ["VOO", quote("120", "118")],
            ["AAA", quote("60", "61")],
          ]),
        ),
        transactions,
        NOW,
      ),
      NOW,
      "Acciones",
    );
    expect(view).toMatchObject({
      version: 1,
      generatedAt: "2026-10-06T18:30:00.000Z",
      title: "Acciones",
      hasTransactions: true,
      partial: false,
      dayTone: "gain",
      gainTone: "gain",
      dayChangePct: "+0,31%",
      totalGainPct: "+4,80%",
      pricesAsOf: "05/10",
    });
    expect(plain(view.totalValue)).toBe("US$ 5.240,00");
    expect(plain(view.dayChange)).toBe("+US$ 16,00");
    expect(plain(view.totalGain)).toBe("+US$ 240,00");
    expect(
      view.positions.map((p) => [
        p.symbol,
        plain(p.value),
        p.dayChangePct,
        p.dayTone,
      ]),
    ).toEqual([
      // VOO 118 → 120; AAA 61 → 60.
      ["VOO", "US$ 1.200,00", "+1,69%", "gain"],
      ["AAA", "US$ 240,00", "-1,64%", "loss"],
    ]);
    // Precios del 05/10 mirados el 06/10: el widget muestra la fecha.
    expect(view.pricesToday).toBe(false);
  });

  it("precios de hoy (hora de Montevideo): el widget no muestra la fecha", () => {
    const today = (price: string, previousClose: string): PriceInfo => ({
      ...quote(price, previousClose),
      // 06/10 a las 00:30 de Montevideo (03:30 UTC): ya es hoy allá.
      asOf: new Date("2026-10-06T03:30:00Z"),
    });
    const view = buildWidgetView(
      buildDashboard(
        valued(
          new Map([
            ["VOO", today("120", "118")],
            ["AAA", today("60", "61")],
          ]),
        ),
        transactions,
        NOW,
      ),
      NOW,
      null,
    );
    expect(view.pricesToday).toBe(true);
    expect(view.pricesAsOf).toBe("06/10");
  });

  it("una posición sin cierre anterior no tiene cambio del día", () => {
    const view = buildWidgetView(
      buildDashboard(
        valued(
          new Map([
            ["VOO", quote("120", null)],
            ["AAA", quote("60", "61")],
          ]),
        ),
        transactions,
        NOW,
      ),
      NOW,
      null,
    );
    expect(view.positions[0]).toMatchObject({
      symbol: "VOO",
      dayChangePct: null,
      dayTone: null,
    });
  });

  it("si falta un precio: total parcial y sin ganancia total (no se puede comparar)", () => {
    const view = buildWidgetView(
      buildDashboard(
        valued(new Map([["VOO", quote("120", "118")]])),
        transactions,
        NOW,
      ),
      NOW,
      null,
    );
    expect(view.partial).toBe(true);
    expect(view.totalGain).toBeNull();
    expect(view.totalGainPct).toBeNull();
    expect(view.gainTone).toBeNull();
    expect(view.title).toBeNull();
  });

  it("sin cierre anterior no hay cambio del día", () => {
    const view = buildWidgetView(
      buildDashboard(
        valued(
          new Map([
            ["VOO", quote("120", null)],
            ["AAA", quote("60", null)],
          ]),
        ),
        transactions,
        NOW,
      ),
      NOW,
      null,
    );
    expect(view.dayChange).toBeNull();
    expect(view.dayChangePct).toBeNull();
    expect(view.dayTone).toBeNull();
  });

  it("sin operaciones lo dice, en vez de mostrar ceros como si fueran datos", () => {
    const view = buildWidgetView(
      buildDashboard(valuePortfolio(computeEngine([]), new Map()), [], NOW),
      NOW,
      null,
    );
    expect(view.hasTransactions).toBe(false);
    expect(view.positions).toEqual([]);
    expect(emptyWidgetView(NOW)).toMatchObject({
      hasTransactions: false,
      pricesToday: false,
      positions: [],
      generatedAt: "2026-10-06T18:30:00.000Z",
    });
  });
});
