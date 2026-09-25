import { describe, expect, it } from "vitest";
import { d, type Transaction } from "@/lib/engine";
import type { TransactionDraft } from "@/lib/importers";
import { findSimilar, similarityKey } from "../import-similar";

const CREATED = new Date("2026-09-24T10:00:00Z");
const ACCOUNT = "acc-1";

const existingBuy = (
  iso: string,
  symbol: string,
  quantity: string,
  price = "600",
): Transaction => ({
  id: `db-${iso}-${symbol}-${quantity}`,
  accountId: ACCOUNT,
  type: "BUY",
  symbol,
  executedAt: new Date(iso),
  createdAt: CREATED,
  currency: "USD",
  quantity: d(quantity),
  price: d(price),
  fee: d("0"),
});

const existingDeposit = (iso: string, amount: string): Transaction => ({
  id: `db-${iso}-dep`,
  accountId: ACCOUNT,
  type: "DEPOSIT",
  symbol: null,
  executedAt: new Date(iso),
  createdAt: CREATED,
  currency: "USD",
  amount: d(amount),
});

const draftBuy = (
  iso: string,
  symbol: string,
  quantity: string,
  price = "600",
  type: "BUY" | "SELL" = "BUY",
): TransactionDraft => ({
  type,
  symbol,
  executedAt: new Date(iso),
  currency: "USD",
  notes: null,
  quantity: d(quantity),
  price: d(price),
  fee: d("0"),
  source: "csv",
  externalId: `csv:${iso}|${symbol}|${quantity}`,
  sourceRow: 2,
});

const draftDeposit = (iso: string, amount: string): TransactionDraft => ({
  type: "DEPOSIT",
  symbol: null,
  executedAt: new Date(iso),
  currency: "USD",
  notes: null,
  amount: d(amount),
  source: "csv",
  externalId: `csv:${iso}|dep|${amount}`,
  sourceRow: 3,
});

describe("similarityKey", () => {
  it("el día se cuenta en hora de Montevideo (UTC−3)", () => {
    // 01:00 UTC del 10 es el 9 a las 22:00 en Montevideo.
    expect(similarityKey(draftBuy("2026-03-10T01:00:00Z", "VOO", "3"))).toBe(
      "2026-03-09|BUY|VOO|3",
    );
    expect(similarityKey(draftBuy("2026-03-10T03:00:00Z", "VOO", "3"))).toBe(
      "2026-03-10|BUY|VOO|3",
    );
  });

  it("no depende de cómo se escribió el número (3 = 3.00)", () => {
    expect(similarityKey(draftBuy("2026-03-09T15:00:00Z", "VOO", "3.00"))).toBe(
      similarityKey(existingBuy("2026-03-09T15:00:00Z", "VOO", "3")),
    );
  });

  it("los depósitos usan el monto; los splits, la razón", () => {
    expect(similarityKey(draftDeposit("2026-03-09T15:00:00Z", "1000"))).toBe(
      "2026-03-09|DEPOSIT||1000",
    );
  });
});

describe("findSimilar", () => {
  it("marca lo que repite una operación ya cargada a mano (mismo día, tipo, símbolo y cantidad), con otra hora y otro precio", () => {
    const existing = [
      existingBuy("2026-03-09T22:34:00Z", "VOO", "3", "575.24"),
    ];
    const drafts = [draftBuy("2026-03-09T15:00:00Z", "VOO", "3", "600")];
    expect([...findSimilar(drafts, existing)]).toEqual(drafts);
  });

  it("no marca otro día, otro símbolo, otra cantidad ni otro tipo", () => {
    const existing = [existingBuy("2026-03-09T15:00:00Z", "VOO", "3")];
    const different = [
      draftBuy("2026-03-10T15:00:00Z", "VOO", "3"),
      draftBuy("2026-03-09T15:00:00Z", "AAPL", "3"),
      draftBuy("2026-03-09T15:00:00Z", "VOO", "4"),
      draftBuy("2026-03-09T15:00:00Z", "VOO", "3", "600", "SELL"),
      draftDeposit("2026-03-09T15:00:00Z", "3"),
    ];
    expect(findSimilar(different, existing).size).toBe(0);
  });

  it("cuenta las repeticiones: dos iguales en el archivo y una ya cargada, se marca una", () => {
    const existing = [existingBuy("2026-03-09T15:00:00Z", "VOO", "1")];
    const first = draftBuy("2026-03-09T15:00:00Z", "VOO", "1");
    const second = {
      ...draftBuy("2026-03-09T15:00:00Z", "VOO", "1"),
      externalId: "otra",
    };
    const similar = findSimilar([first, second], existing);
    expect(similar.size).toBe(1);
    expect(similar.has(first)).toBe(true);
    expect(similar.has(second)).toBe(false);
  });

  it("con dos ya cargadas, se marcan las dos", () => {
    const existing = [
      existingBuy("2026-03-09T15:00:00Z", "VOO", "1"),
      existingBuy("2026-03-09T18:00:00Z", "VOO", "1"),
    ];
    const drafts = [
      draftBuy("2026-03-09T15:00:00Z", "VOO", "1"),
      { ...draftBuy("2026-03-09T15:00:00Z", "VOO", "1"), externalId: "b" },
    ];
    expect(findSimilar(drafts, existing).size).toBe(2);
  });

  it("depósitos: mismo día y mismo monto", () => {
    const existing = [existingDeposit("2026-03-06T22:30:00Z", "4200")];
    const drafts = [
      draftDeposit("2026-03-06T15:00:00Z", "4200"),
      draftDeposit("2026-03-06T15:00:00Z", "3571"),
    ];
    expect([...findSimilar(drafts, existing)]).toEqual([drafts[0]]);
  });

  it("sin nada cargado, nada es parecido", () => {
    expect(
      findSimilar([draftBuy("2026-03-09T15:00:00Z", "VOO", "3")], []).size,
    ).toBe(0);
  });
});
