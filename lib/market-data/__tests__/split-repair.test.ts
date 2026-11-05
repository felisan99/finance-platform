import { describe, expect, it } from "vitest";
import {
  SPLIT_REPAIR_MAX_BARS,
  repairPartialSplitAdjustment,
} from "../split-repair";
import type { CorporateAction, DailyBar } from "../types";

const bars = (rows: Array<[string, string]>): DailyBar[] =>
  rows.map(([date, close]) => ({ date, close, adjClose: close }));
const split = (exDate: string, ratio: string): CorporateAction => ({
  type: "SPLIT",
  exDate,
  ratio,
});
const closes = (result: { bars: DailyBar[] }) =>
  result.bars.map((bar) => bar.close);

// Lo que devolvía Yahoo para SOXX el 2026-11-05: split 3:1 informado, hasta el 30/10 ajustado y
// del 2 al 4/11 todavía en la escala vieja.
const SOXX = bars([
  ["2026-10-28", "173.98"],
  ["2026-10-29", "171.29"],
  ["2026-10-30", "157.17"],
  ["2026-11-02", "453.65"],
  ["2026-11-03", "465"],
  ["2026-11-04", "450.41"],
  ["2026-11-05", "131.9"],
]);

describe("repairPartialSplitAdjustment", () => {
  it("ajusta los cierres que Yahoo dejó en la escala vieja antes del split (SOXX 3:1)", () => {
    const result = repairPartialSplitAdjustment(SOXX, [
      split("2026-11-05", "3"),
    ]);
    expect(closes(result)).toEqual([
      "173.98",
      "171.29",
      "157.17",
      "151.2167",
      "155",
      "150.1367",
      "131.9",
    ]);
    expect(result.bars[3]!.adjClose).toBe("151.2167");
    expect(result.repairedBars).toBe(3);
  });

  it("no toca una serie que ya vino bien ajustada", () => {
    const fine = bars([
      ["2026-10-30", "157.17"],
      ["2026-11-02", "151.22"],
      ["2026-11-03", "155"],
      ["2026-11-04", "150.14"],
      ["2026-11-05", "131.9"],
    ]);
    const result = repairPartialSplitAdjustment(fine, [
      split("2026-11-05", "3"),
    ]);
    expect(result.bars).toEqual(fine);
    expect(result.repairedBars).toBe(0);
  });

  it("sin la caída del día del split no repara aunque haya un salto antes", () => {
    // Yahoo no ajustó nada todavía: no hay un tramo "a medio ajustar" que reconocer.
    const unadjusted = bars([
      ["2026-10-30", "471.51"],
      ["2026-11-02", "453.65"],
      ["2026-11-03", "465"],
      ["2026-11-04", "450.41"],
      ["2026-11-05", "450"],
    ]);
    expect(
      repairPartialSplitAdjustment(unadjusted, [split("2026-11-05", "3")])
        .repairedBars,
    ).toBe(0);
  });

  it("sin el salto antes del split (dentro de la ventana) no repara", () => {
    const long = bars(
      Array.from({ length: SPLIT_REPAIR_MAX_BARS + 2 }, (_, i) => [
        `2026-10-${String(10 + i).padStart(2, "0")}`,
        "450",
      ]),
    );
    long.push({ date: "2026-11-05", close: "150", adjClose: "150" });
    const result = repairPartialSplitAdjustment(long, [
      split("2026-11-05", "3"),
    ]);
    expect(result.repairedBars).toBe(0);
  });

  it("una caída y una suba reales grandes (no de la razón del split) no se tocan", () => {
    const volatile = bars([
      ["2026-10-30", "100"],
      ["2026-11-02", "160"], // +60 %: más cerca de 1 que de 3
      ["2026-11-03", "165"],
      ["2026-11-04", "160"],
      ["2026-11-05", "100"], // −37 %
    ]);
    expect(
      repairPartialSplitAdjustment(volatile, [split("2026-11-05", "3")])
        .repairedBars,
    ).toBe(0);
  });

  it("un split inverso 1:10 a medio ajustar se multiplica por 10", () => {
    const reverse = bars([
      ["2026-10-29", "20"],
      ["2026-10-30", "21"],
      ["2026-11-02", "2.2"],
      ["2026-11-03", "2.1"],
      ["2026-11-04", "2"],
      ["2026-11-05", "19.5"],
    ]);
    const result = repairPartialSplitAdjustment(reverse, [
      split("2026-11-05", "0.1"),
    ]);
    expect(closes(result)).toEqual(["20", "21", "22", "21", "20", "19.5"]);
    expect(result.repairedBars).toBe(3);
  });

  it("un split chico (5:4) no se repara: se confunde con un movimiento real", () => {
    const small = bars([
      ["2026-10-30", "80"],
      ["2026-11-02", "100"],
      ["2026-11-03", "100"],
      ["2026-11-04", "100"],
      ["2026-11-05", "80"],
    ]);
    expect(
      repairPartialSplitAdjustment(small, [split("2026-11-05", "1.25")])
        .repairedBars,
    ).toBe(0);
  });

  it("ignora dividendos, splits sin ruedas alrededor y no muta la entrada", () => {
    const frozen = Object.freeze(SOXX.map((bar) => Object.freeze({ ...bar })));
    const before = JSON.stringify(frozen);
    const result = repairPartialSplitAdjustment(frozen, [
      { type: "DIVIDEND", exDate: "2026-11-03", amount: "0.3" },
      split("2026-10-28", "3"), // primera rueda: no hay anterior
      split("2027-01-04", "3"), // después de la serie
    ]);
    expect(result.repairedBars).toBe(0);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});
