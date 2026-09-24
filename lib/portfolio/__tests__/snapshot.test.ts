import { describe, expect, it } from "vitest";
import type { Dec } from "@/lib/engine";
import { buildSnapshot, type SnapshotInput } from "../snapshot";
import type { AccountRow, ClosesRow, QuoteRow } from "../rows";
import { fixtureInstruments, fixtureRows } from "./fixture";

const account: AccountRow = {
  id: "acc-1",
  name: "Cuenta principal",
  currency: "USD",
  cost_method: "AVERAGE",
};

const quote = (
  symbol: string,
  price: string,
  change: string | null = null,
  asOf = "2026-09-23T20:00:00+00:00",
): QuoteRow => ({
  instrument_id: `id-${symbol}`,
  price,
  change,
  as_of: asOf,
});
const closes = (
  symbol: string,
  last: [string, string],
  prev: [string, string] | null,
): ClosesRow => ({
  instrument_id: `id-${symbol}`,
  last_close: last[1],
  last_date: last[0],
  prev_close: prev?.[1] ?? null,
  prev_date: prev?.[0] ?? null,
});

const input = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  account,
  transactionRows: fixtureRows(),
  instruments: fixtureInstruments(),
  quotes: [],
  closes: [],
  ...over,
});

const num = (value: Dec | null) => (value === null ? null : value.toFixed());

describe("buildSnapshot con el CSV de Delta", () => {
  it("sin precios: el costo, el realizado y el efectivo de la sección 8.3, y todo lo abierto sin precio", () => {
    const snap = buildSnapshot(input());
    expect(snap.engine.cash.toFixed()).toBe("882.745");
    expect(snap.engine.totals.openCostBasis.toFixed()).toBe("8664.27");
    expect(snap.engine.totals.realizedPnl.toFixed()).toBe("247.015");
    expect(snap.valued.missingPrices).toEqual([
      "FSLY",
      "ILF",
      "NFLX",
      "SOXX",
      "VOO",
    ]);
    // Sin precios el total es solo el efectivo (y la pantalla avisa que es parcial).
    expect(snap.valued.totalValue.toFixed()).toBe("882.745");
    expect(snap.valued.unrealizedPct).toBeNull();
  });

  it("con cotización de todas las abiertas: valor y ganancia calculados a mano", () => {
    const snap = buildSnapshot(
      input({
        quotes: [
          quote("VOO", "700"),
          quote("SOXX", "500"),
          quote("FSLY", "30"),
          quote("ILF", "35"),
          quote("NFLX", "100"),
        ],
      }),
    );
    // VOO 8.95 × 700 = 6265 · SOXX 3 × 500 = 1500 · FSLY 20 × 30 = 600 · ILF 10 × 35 = 350 · NFLX 3 × 100 = 300
    expect(snap.valued.marketValue.toFixed()).toBe("9785");
    expect(snap.valued.totalValue.toFixed()).toBe("10667.745"); // + efectivo 882.745
    expect(snap.valued.unrealizedPnl.toFixed()).toBe("1120.73"); // 9785 − 8664.27
    expect(snap.valued.missingPrices).toEqual([]);
    expect(snap.valued.realizedPnl.toFixed()).toBe("247.015");
    const voo = snap.valued.positions.find((p) => p.symbol === "VOO");
    expect(voo?.marketValue?.toFixed()).toBe("6265");
    expect(voo?.unrealizedPnl?.toFixed()).toBe("540.23"); // 6265 − 5724.77
  });

  it("una posición sin precio no se cuela en el total y queda listada", () => {
    const snap = buildSnapshot(
      input({
        quotes: [
          quote("VOO", "700"),
          quote("SOXX", "500"),
          quote("ILF", "35"),
          quote("NFLX", "100"),
        ],
      }),
    );
    expect(snap.valued.missingPrices).toEqual(["FSLY"]);
    expect(snap.valued.marketValue.toFixed()).toBe("8885");
    // Ganancia solo de lo que tiene precio: 8885 − (8664.27 − 346.80 de FSLY) = 567.53
    expect(snap.valued.unrealizedPnl.toFixed()).toBe("567.53");
  });

  it("las posiciones cerradas no piden precio aunque haya cotización", () => {
    const snap = buildSnapshot(input({ quotes: [quote("MELI", "1799.24")] }));
    expect(snap.prices.has("MELI")).toBe(false);
    expect(snap.valued.missingPrices).not.toContain("MELI");
  });

  it("elige entre cotización y cierre por fecha, y toma el cierre anterior del proveedor", () => {
    const snap = buildSnapshot(
      input({
        quotes: [
          quote("VOO", "707.6", "-5.18", "2026-09-23T20:00:00+00:00"), // del 23/9
          quote("SOXX", "999", null, "2026-09-20T20:00:00+00:00"), // vieja: hay un cierre del 23/9
        ],
        closes: [
          closes("VOO", ["2026-09-23", "707.6"], ["2026-09-21", "712.78"]),
          closes("SOXX", ["2026-09-23", "562.69"], ["2026-09-22", "560"]),
          closes("ILF", ["2026-09-23", "34.69"], ["2026-09-22", "34.1"]), // sin cotización: solo cierres
        ],
      }),
    );
    expect(snap.prices.get("VOO")).toMatchObject({ source: "quote" });
    expect(num(snap.prices.get("VOO")?.previousClose ?? null)).toBe("712.78"); // 707.6 − (−5.18)
    expect(snap.prices.get("SOXX")).toMatchObject({ source: "close" });
    expect(num(snap.prices.get("SOXX")?.price ?? null)).toBe("562.69");
    expect(snap.prices.get("ILF")).toMatchObject({ source: "close" });
    // Cambio del día de SOXX: (562.69 − 560) × 3 = 8.07
    const soxx = snap.valued.positions.find((p) => p.symbol === "SOXX");
    expect(num(soxx?.dayChange ?? null)).toBe("8.07");
  });

  it("guarda las filas, las transacciones del motor y los índices de instrumentos", () => {
    const snap = buildSnapshot(input());
    expect(snap.rows).toHaveLength(snap.transactions.length);
    expect(snap.instrumentBySymbol.get("VOO")?.id).toBe("id-VOO");
    expect(snap.instrumentById.get("id-MELI")?.symbol).toBe("MELI");
  });

  it("respeta la moneda de la cuenta: en una cuenta que no es USD, las operaciones en USD son un error", () => {
    const snap = buildSnapshot(
      input({ account: { ...account, currency: "EUR" } }),
    );
    expect(
      snap.engine.issues.some((i) => i.code === "UNSUPPORTED_CURRENCY"),
    ).toBe(true);
    expect(snap.engine.cash.toFixed()).toBe("0"); // nada se aplicó
  });

  it("sin transacciones: libro vacío", () => {
    const snap = buildSnapshot(input({ transactionRows: [], instruments: [] }));
    expect(snap.valued.positions).toEqual([]);
    expect(snap.valued.totalValue.toFixed()).toBe("0");
    expect(snap.engine.issues).toEqual([]);
  });

  it("una transacción que apunta a un instrumento que no vino: error claro", () => {
    expect(() =>
      buildSnapshot(
        input({
          instruments: fixtureInstruments().filter((i) => i.symbol !== "VOO"),
        }),
      ),
    ).toThrow(/no tiene instrumento/);
  });

  it("los issues del motor viajan en el estado (efectivo negativo, ventas de más)", () => {
    const rows = fixtureRows().filter((r) => r.type !== "DEPOSIT"); // sin depósitos: el efectivo queda negativo
    const snap = buildSnapshot(input({ transactionRows: rows }));
    expect(snap.engine.issues.map((i) => i.code)).toContain("NEGATIVE_CASH");
  });
});
