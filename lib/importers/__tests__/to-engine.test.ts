import { describe, expect, it } from "vitest";
import { computeEngine, d } from "@/lib/engine";
import { toEngineTransactions, type TransactionDraft } from "@/lib/importers";

// toEngineTransactions no es solo de Delta: lo usará cualquier importador (IBKR Flex, Fase 8),
// así que se prueba con todos los tipos de borrador.

const at = (day: number) => new Date(Date.UTC(2026, 0, day));
const meta = { source: "ibkr_flex" as const, sourceRow: 0 };
const common = (day: number, id: string) => ({
  executedAt: at(day),
  currency: "USD",
  notes: null,
  externalId: id,
  ...meta,
});

const drafts: TransactionDraft[] = [
  { ...common(1, "dep"), type: "DEPOSIT", symbol: null, amount: d("1000") },
  {
    ...common(2, "buy"),
    type: "BUY",
    symbol: "VOO",
    quantity: d("2"),
    price: d("100"),
    fee: d("1"),
  },
  { ...common(3, "split"), type: "SPLIT", symbol: "VOO", splitRatio: d("2") },
  { ...common(4, "div"), type: "DIVIDEND", symbol: "VOO", amount: d("3") },
  { ...common(5, "tax"), type: "TAX", symbol: "VOO", amount: d("0.5") },
  { ...common(6, "int"), type: "INTEREST", symbol: null, amount: d("2") },
  { ...common(7, "fee"), type: "FEE", symbol: null, amount: d("1.5") },
  {
    ...common(8, "sell"),
    type: "SELL",
    symbol: "VOO",
    quantity: d("1"),
    price: d("60"),
    fee: d("1"),
  },
  { ...common(9, "wd"), type: "WITHDRAWAL", symbol: null, amount: d("100") },
];

describe("toEngineTransactions", () => {
  const importedAt = new Date("2026-09-23T12:00:00Z");
  const txs = toEngineTransactions(drafts, { accountId: "acc-7", importedAt });

  it("conserva el tipo, el símbolo y los montos de cada borrador", () => {
    expect(txs.map((t) => [t.id, t.type])).toEqual(
      drafts.map((x) => [x.externalId, x.type]),
    );
    for (const tx of txs) {
      expect(tx.accountId).toBe("acc-7");
      expect(tx.createdAt).toBe(importedAt);
      expect(tx.currency).toBe("USD");
    }
    const split = txs.find((t) => t.type === "SPLIT");
    expect(split?.type === "SPLIT" && split.splitRatio.toFixed()).toBe("2");
    const dividend = txs.find((t) => t.type === "DIVIDEND");
    expect(dividend?.type === "DIVIDEND" && dividend.amount.toFixed()).toBe(
      "3",
    );
  });

  it("el motor los procesa sin issues", () => {
    const r = computeEngine(txs);
    expect(r.issues).toEqual([]);
    // 1000 − 201 (compra) + 3 (dividendo) − 0.5 (impuesto) + 2 (interés) − 1.5 (comisión)
    //      + 59 (venta 1 a 60 con comisión 1) − 100 (retiro) = 761
    expect(r.cash.toFixed()).toBe("761");
    // Tras el split 2:1 quedan 4 acciones con costo 201; vender 1 consume 50.25.
    const voo = r.positions.find((p) => p.symbol === "VOO");
    expect(voo?.quantity.toFixed()).toBe("3");
    expect(voo?.costBasis.toFixed()).toBe("150.75");
    expect(voo?.realizedPnl.toFixed()).toBe("8.75");
    expect(voo?.dividends.toFixed()).toBe("3");
  });

  it("no muta los borradores", () => {
    const before = JSON.stringify(drafts.map((x) => x.externalId));
    toEngineTransactions(drafts, { accountId: "otra", importedAt });
    expect(JSON.stringify(drafts.map((x) => x.externalId))).toBe(before);
  });
});
