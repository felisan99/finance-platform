import { describe, it } from "vitest";
import { cashDelta, computeCash } from "../cash";
import {
  buy,
  cashTx,
  deposit,
  dividend,
  expectDec,
  sell,
  split,
  withdrawal,
} from "./helpers";

const T = "2026-03-09T22:34:00Z";

describe("cashDelta (spec §6.2)", () => {
  it("DEPOSIT suma y WITHDRAWAL resta", () => {
    expectDec(cashDelta(deposit(T, "4200")), "4200");
    expectDec(cashDelta(withdrawal(T, "100")), "-100");
  });

  it("BUY resta cantidad·precio + comisión", () => {
    // 3 VOO a 575.24 + comisión 1 = 1726.72 (fila del fixture de Delta)
    expectDec(cashDelta(buy(T, "VOO", "3", "575.24", "1")), "-1726.72");
  });

  it("SELL suma cantidad·precio − comisión", () => {
    // 37 KOS a 3.165 − comisión 1 = 116.105 (fila del fixture de Delta)
    expectDec(cashDelta(sell(T, "KOS", "37", "3.165", "1")), "116.105");
  });

  it("DIVIDEND e INTEREST suman; FEE y TAX restan", () => {
    expectDec(cashDelta(dividend(T, "VOO", "5.25")), "5.25");
    expectDec(cashDelta(cashTx("INTEREST", T, "2")), "2");
    expectDec(cashDelta(cashTx("FEE", T, "3")), "-3");
    expectDec(cashDelta(cashTx("TAX", T, "0.75", "VOO")), "-0.75");
  });

  it("un INTEREST negativo (interés de margen) resta", () => {
    expectDec(cashDelta(cashTx("INTEREST", T, "-2.5")), "-2.5");
  });

  it("SPLIT no mueve efectivo", () => {
    expectDec(cashDelta(split(T, "NVDA", "10")), "0");
  });
});

describe("computeCash", () => {
  it("es la suma de los deltas de todos los tipos", () => {
    const txs = [
      deposit("2026-01-01T00:00:00Z", "1000"),
      withdrawal("2026-01-02T00:00:00Z", "100"),
      buy("2026-01-03T00:00:00Z", "VOO", "2", "50", "1"), // -101
      sell("2026-01-04T00:00:00Z", "VOO", "1", "60", "1"), // +59
      dividend("2026-01-05T00:00:00Z", "VOO", "5"),
      cashTx("INTEREST", "2026-01-06T00:00:00Z", "2"),
      cashTx("FEE", "2026-01-07T00:00:00Z", "3"),
      cashTx("TAX", "2026-01-08T00:00:00Z", "1", "VOO"),
    ];
    // 1000 − 100 − 101 + 59 + 5 + 2 − 3 − 1
    expectDec(computeCash(txs), "861");
  });

  it("un historial vacío deja el efectivo en 0", () => {
    expectDec(computeCash([]), "0");
  });
});
