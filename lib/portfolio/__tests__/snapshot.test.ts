import { describe, expect, it } from "vitest";
import type { Dec } from "@/lib/engine";
import { buildSnapshot, type SnapshotInput } from "../snapshot";
import type { PortfolioRef } from "../portfolio-scope";
import type { AccountRow, ClosesRow, QuoteRow, TransactionRow } from "../rows";
import { fixtureInstruments, fixtureRows } from "./fixture";

const account: AccountRow = {
  id: "acc-1",
  name: "Cuenta principal",
  currency: "USD",
  cost_method: "AVERAGE",
};
const portfolio = {
  id: "p-1",
  name: "Principal",
  benchmarkSymbol: "SPY",
  account,
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

/** Un solo portafolio (el alcance de siempre), con lo que se quiera cambiar. */
const input = (
  over: Partial<Omit<SnapshotInput, "scope" | "parts">> & {
    portfolio?: PortfolioRef;
    transactionRows?: TransactionRow[];
  } = {},
): SnapshotInput => {
  const {
    portfolio: chosen = portfolio,
    transactionRows = fixtureRows(),
    ...rest
  } = over;
  return {
    scope: { kind: "one", portfolio: chosen },
    parts: [{ portfolio: chosen, transactionRows }],
    instruments: fixtureInstruments(),
    quotes: [],
    closes: [],
    ...rest,
  };
};

const num = (value: Dec | null) => (value === null ? null : value.toFixed());

describe("buildSnapshot con el CSV de Delta", () => {
  it("es del portafolio que se pidió: su cuenta en cada transacción", () => {
    const snap = buildSnapshot(input());
    expect(snap.scope).toEqual({ kind: "one", portfolio });
    expect(snap.parts).toHaveLength(1);
    expect(snap.parts[0]!.portfolio).toBe(portfolio);
    expect(snap.benchmarkSymbol).toBe("SPY");
    expect(snap.transactions.length).toBeGreaterThan(0);
    expect(snap.transactions.every((tx) => tx.accountId === account.id)).toBe(
      true,
    );
  });

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
    // VOO 8.95 × 700 = 6265 · SOXX 4 × 500 = 2000 · FSLY 30 × 30 = 900 · ILF 12 × 35 = 420 · NFLX 2 × 100 = 200
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
    // Cambio del día de SOXX: (562.69 − 560) × 4 = 10.76
    const soxx = snap.valued.positions.find((p) => p.symbol === "SOXX");
    expect(num(soxx?.dayChange ?? null)).toBe("10.76");
  });

  it("guarda las filas, las transacciones del motor y los índices de instrumentos", () => {
    const snap = buildSnapshot(input());
    expect(snap.parts[0]!.rows).toHaveLength(snap.transactions.length);
    // Con un portafolio, el motor es el de su cuenta (no una suma).
    expect(snap.engine).toBe(snap.parts[0]!.engine);
    expect(snap.instrumentBySymbol.get("VOO")?.id).toBe("id-VOO");
    expect(snap.instrumentById.get("id-MELI")?.symbol).toBe("MELI");
  });

  it("respeta la moneda de la cuenta: en una cuenta que no es USD, las operaciones en USD son un error", () => {
    const snap = buildSnapshot(
      input({
        portfolio: { ...portfolio, account: { ...account, currency: "EUR" } },
      }),
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

describe("buildSnapshot con «Todo junto»", () => {
  const cripto: PortfolioRef = {
    id: "p-2",
    name: "Cripto",
    benchmarkSymbol: "SPY",
    account: { ...account, id: "acc-2" },
  };
  // El segundo portafolio: deposita 2000 y compra 2 VOO a 500 (con 1 de comisión).
  const secondRows = (): TransactionRow[] => [
    {
      ...fixtureRows()[0]!,
      id: "c-1",
      type: "DEPOSIT",
      instrument_id: null,
      executed_at: "2026-04-01T15:00:00+00:00",
      quantity: null,
      price: null,
      amount: "2000.0000",
      fee: "0.0000",
      split_ratio: null,
      external_id: null,
      seq: 9001,
    },
    {
      ...fixtureRows()[0]!,
      id: "c-2",
      type: "BUY",
      instrument_id: "id-VOO",
      executed_at: "2026-04-02T15:00:00+00:00",
      quantity: "2.00000000",
      price: "500.00000000",
      amount: null,
      fee: "1.0000",
      split_ratio: null,
      external_id: null,
      seq: 9002,
    },
  ];
  const all = (): SnapshotInput => ({
    scope: { kind: "all", portfolios: [portfolio, cripto] },
    parts: [
      { portfolio, transactionRows: fixtureRows() },
      { portfolio: cripto, transactionRows: secondRows() },
    ],
    instruments: fixtureInstruments(),
    quotes: [quote("VOO", "600")],
    closes: [],
  });

  it("cada portafolio con su cuenta y su motor; la suma arriba", () => {
    const one = buildSnapshot(input({ quotes: [quote("VOO", "600")] }));
    const snap = buildSnapshot(all());
    expect(snap.parts.map((p) => p.portfolio.id)).toEqual(["p-1", "p-2"]);
    expect(
      snap.parts[1]!.transactions.every((tx) => tx.accountId === "acc-2"),
    ).toBe(true);
    // Efectivo: 882.745 del primero + 999 del segundo (2000 − 1000 − 1).
    expect(snap.engine.cash.toFixed()).toBe("1881.745");
    expect(snap.engine.totals.openCostBasis.toFixed()).toBe(
      one.engine.totals.openCostBasis.plus(1001).toFixed(),
    );
    const voo = (s: typeof snap) =>
      s.valued.positions.find((p) => p.symbol === "VOO")!;
    expect(voo(snap).quantity.minus(voo(one).quantity).toFixed()).toBe("2");
    // El valor de mercado de VOO es el de la cantidad sumada, al mismo precio.
    expect(voo(snap).marketValue?.toFixed()).toBe(
      voo(snap).quantity.mul(600).toFixed(),
    );
    expect(snap.valued.totalValue.toFixed()).toBe(
      one.valued.totalValue.plus(999).plus(1200).toFixed(),
    );
  });

  it("las transacciones de todos, en orden cronológico", () => {
    const snap = buildSnapshot(all());
    expect(snap.transactions).toHaveLength(fixtureRows().length + 2);
    const times = snap.transactions.map((tx) => tx.executedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("el benchmark: el que comparten todos", () => {
    expect(buildSnapshot(all()).benchmarkSymbol).toBe("SPY");
  });
});
