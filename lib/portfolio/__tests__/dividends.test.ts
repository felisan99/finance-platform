import { describe, expect, it } from "vitest";
import { computeEngine, d, type Transaction } from "@/lib/engine";
import {
  buildPendingDividendsView,
  withholdingValueOf,
} from "../dividends-view";
import { dividendToInsertRows, dividendToTransactions } from "../mappers";
import type { PortfolioRef } from "../portfolio-scope";

const NBSP = " ";
const suggestion = {
  eventId: "00000000-0000-4000-8000-0000000000aa",
  symbol: "KO",
  exDate: "2026-03-13",
  shares: d("100"),
  perShare: d("0.51"),
  gross: d("51"),
  withholding: d("15.3"),
  net: d("35.7"),
};
const portfolio = {
  id: "p",
  name: "Principal",
  benchmarkSymbol: "SPY",
  account: {
    id: "acc",
    name: "Cuenta",
    currency: "USD",
    cost_method: "AVERAGE",
  },
} as PortfolioRef;

describe("dividendToInsertRows", () => {
  const ctx = {
    userId: "u",
    accountId: "acc",
    instrumentId: "ins",
    currency: "USD",
  };

  it("guarda el dividendo bruto y la retención como impuesto, con ids que no se repiten", () => {
    const rows = dividendToInsertRows(suggestion, ctx);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      type: "DIVIDEND",
      amount: 51,
      source: "auto_dividend",
      external_id: `div:${suggestion.eventId}`,
      instrument_id: "ins",
      executed_at: "2026-03-13T16:00:00.000Z",
    });
    // Mismas columnas en todas las filas: PostgREST completa con NULL las que falten.
    expect(Object.keys(rows[0]!).sort()).toEqual(Object.keys(rows[1]!).sort());
    expect(rows[0]!.fee).toBe(0);
    expect(rows[1]).toMatchObject({
      type: "TAX",
      amount: 15.3,
      external_id: `divtax:${suggestion.eventId}`,
    });
  });

  it("sin retención no guarda un impuesto en 0", () => {
    expect(
      dividendToInsertRows({ ...suggestion, withholding: d("0") }, ctx),
    ).toHaveLength(1);
  });
});

describe("dividendToTransactions", () => {
  it("el libro las acepta y el efectivo sube el neto", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    const ledger: Transaction[] = [
      {
        id: "dep",
        accountId: "acc",
        type: "DEPOSIT",
        symbol: null,
        amount: d("6000"),
        executedAt: new Date("2026-01-02T15:00:00Z"),
        createdAt: now,
        currency: "USD",
      },
      {
        id: "buy",
        accountId: "acc",
        type: "BUY",
        symbol: "KO",
        quantity: d("100"),
        price: d("60"),
        fee: d("0"),
        executedAt: new Date("2026-01-05T15:00:00Z"),
        createdAt: now,
        currency: "USD",
      },
    ];
    const txs = dividendToTransactions(suggestion, {
      accountId: "acc",
      currency: "USD",
      now,
    });
    const result = computeEngine([...ledger, ...txs]);
    expect(result.issues).toEqual([]);
    expect(result.cash.toFixed()).toBe("35.7");
    expect(result.totals.dividends.toFixed()).toBe("51");
    expect(result.totals.taxes.toFixed()).toBe("15.3");
  });
});

describe("vista de dividendos", () => {
  it("formatea montos, la retención en negativo y el portafolio solo si hay varios", () => {
    const [one] = buildPendingDividendsView(
      [{ key: "acc:ev", portfolio, suggestion }],
      false,
    );
    expect(one).toEqual({
      key: "acc:ev",
      symbol: "KO",
      portfolioName: null,
      exDate: "13/03/2026",
      detail: `100 × US$${NBSP}0,51`,
      gross: `US$${NBSP}51,00`,
      withholding: `-US$${NBSP}15,30`,
      net: `US$${NBSP}35,70`,
    });
    expect(
      buildPendingDividendsView([{ key: "k", portfolio, suggestion }], true)[0]
        ?.portfolioName,
    ).toBe("Principal");
  });

  it("muestra la opción de retención guardada, o la más cercana", () => {
    expect(withholdingValueOf(d("0.3"))).toBe("0.30");
    expect(withholdingValueOf(d("0.15"))).toBe("0.15");
    expect(withholdingValueOf(d("0"))).toBe("0");
    expect(withholdingValueOf(d("0.27"))).toBe("0.30");
  });
});
