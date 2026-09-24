import { describe, expect, it } from "vitest";
import { d } from "@/lib/engine";
import { describeTransaction, formatSplitRatio } from "../tx-view";
import type { TransactionRow } from "../rows";

const plain = (value: string) => value.replace(/[  ]/g, " ");
const symbols = new Map([["i-voo", "VOO"]]);
const row = (over: Partial<TransactionRow>): TransactionRow => ({
  id: "r1",
  type: "BUY",
  instrument_id: "i-voo",
  executed_at: "2026-03-09T22:34:00+00:00",
  quantity: "3.00000000",
  price: "575.24000000",
  amount: null,
  fee: "1.0000",
  currency: "USD",
  split_ratio: null,
  notes: null,
  source: "delta_csv",
  external_id: "x",
  created_at: "2026-09-24T10:00:00+00:00",
  seq: 1,
  ...over,
});
const view = (over: Partial<TransactionRow>) =>
  describeTransaction(row(over), "acc", symbols);

describe("describeTransaction", () => {
  it("compra: cantidad × precio, comisión y efectivo negativo", () => {
    const v = view({});
    expect(v).toMatchObject({
      id: "r1",
      type: "BUY",
      typeLabel: "Compra",
      symbol: "VOO",
      source: "delta_csv",
    });
    expect(plain(v.detail)).toBe("3 × 575,24 · comisión US$ 1,00");
    expect(v.cash.toFixed()).toBe("-1726.72"); // 3 × 575.24 + 1
    expect(v.executedAt).toEqual(new Date("2026-03-09T22:34:00Z"));
  });

  it("compra sin comisión: no la menciona", () => {
    expect(plain(view({ fee: "0.0000" }).detail)).toBe("3 × 575,24");
  });

  it("venta: efectivo positivo neto de comisión", () => {
    const v = view({
      type: "SELL",
      quantity: "37.00000000",
      price: "117.10500000",
      fee: "1.0000",
    });
    expect(v.typeLabel).toBe("Venta");
    expect(v.cash.toFixed()).toBe("4331.885"); // 37 × 117.105 − 1
  });

  it("dividendo: efectivo positivo, con el símbolo", () => {
    const v = view({
      type: "DIVIDEND",
      quantity: null,
      price: null,
      amount: "2.5000",
      fee: "0.0000",
      notes: "trimestral",
    });
    expect(v).toMatchObject({ typeLabel: "Dividendo", symbol: "VOO" });
    expect(v.cash.toFixed()).toBe("2.5");
    expect(v.detail).toBe("trimestral");
  });

  it("depósito y retiro: sin símbolo; el detalle son las notas", () => {
    const dep = view({
      type: "DEPOSIT",
      instrument_id: null,
      quantity: null,
      price: null,
      amount: "4200.0000",
      fee: "0.0000",
      notes: "Comision 30USD",
    });
    expect(dep).toMatchObject({
      typeLabel: "Depósito",
      symbol: null,
      detail: "Comision 30USD",
    });
    expect(dep.cash.toFixed()).toBe("4200");
    const wd = view({
      type: "WITHDRAWAL",
      instrument_id: null,
      quantity: null,
      price: null,
      amount: "100.0000",
      fee: "0.0000",
    });
    expect(wd.cash.toFixed()).toBe("-100");
    expect(wd.detail).toBe("");
  });

  it("comisión, impuesto e interés", () => {
    const base = {
      instrument_id: null,
      quantity: null,
      price: null,
      fee: "0.0000",
    };
    expect(
      view({ ...base, type: "FEE", amount: "5.0000" }).cash.toFixed(),
    ).toBe("-5");
    expect(
      view({ ...base, type: "TAX", amount: "3.0000" }).cash.toFixed(),
    ).toBe("-3");
    expect(
      view({ ...base, type: "INTEREST", amount: "-3.2500" }).cash.toFixed(),
    ).toBe("-3.25");
    expect(
      view({ ...base, type: "INTEREST", amount: "0.8000" }).typeLabel,
    ).toBe("Interés");
  });

  it("una retención de impuesto atada a un símbolo conserva el símbolo", () => {
    expect(
      view({
        type: "TAX",
        quantity: null,
        price: null,
        amount: "0.5000",
        fee: "0.0000",
      }).symbol,
    ).toBe("VOO");
  });

  it("split: razón legible y sin efecto en el efectivo", () => {
    const v = view({
      type: "SPLIT",
      quantity: null,
      price: null,
      split_ratio: "10.00000000",
      fee: "0.0000",
    });
    expect(v).toMatchObject({ typeLabel: "Split", detail: "10 por 1" });
    expect(v.cash.toFixed()).toBe("0");
  });
});

describe("formatSplitRatio", () => {
  it.each([
    ["10", "10 por 1"],
    ["1.5", "1,5 por 1"],
    ["2", "2 por 1"],
    ["0.1", "1 por 10"],
    ["0.5", "1 por 2"],
    ["0.33333333", "1 por 3"],
    ["1", "1 por 1"],
  ])("%s → %s", (ratio, expected) => {
    expect(plain(formatSplitRatio(d(ratio)))).toBe(expected);
  });
});
