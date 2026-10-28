import { describe, expect, it } from "vitest";
import { d } from "../decimal";
import { summarizeCloses } from "../price-summary";
import { expectDec } from "./helpers";

const closes = [
  { date: "2026-09-25", close: d("110") },
  { date: "2026-09-21", close: d("100") },
  { date: "2026-09-22", close: d("95") },
  { date: "2026-09-23", close: d("120") },
  { date: "2026-09-24", close: d("95") },
];

describe("summarizeCloses", () => {
  it("primero, último, extremos y variación, aunque lleguen desordenados", () => {
    const summary = summarizeCloses(closes, "2026-09-21", "2026-09-25")!;
    expect(summary.first.date).toBe("2026-09-21");
    expect(summary.last.date).toBe("2026-09-25");
    expect(summary.min.date).toBe("2026-09-22"); // el primero de los repetidos
    expect(summary.max.date).toBe("2026-09-23");
    expectDec(summary.change!, "0.1");
    expect(summary.count).toBe(5);
  });

  it("respeta el rango inclusive", () => {
    const summary = summarizeCloses(closes, "2026-09-23", "2026-09-24")!;
    expect(summary.count).toBe(2);
    expectDec(summary.change!, "-0.2083333333333333333333333333333333333333");
  });

  it("un solo cierre: variación 0", () => {
    const summary = summarizeCloses(closes, "2026-09-25", "2026-09-30")!;
    expect(summary.count).toBe(1);
    expectDec(summary.change!, "0");
  });

  it("sin cierres en el rango: null", () => {
    expect(summarizeCloses(closes, "2026-10-01", "2026-10-30")).toBeNull();
    expect(summarizeCloses([], "2026-09-01", "2026-09-30")).toBeNull();
  });

  it("primer cierre en 0: variación null", () => {
    const summary = summarizeCloses(
      [
        { date: "2026-09-21", close: d("0") },
        { date: "2026-09-22", close: d("1") },
      ],
      "2026-09-21",
      "2026-09-22",
    )!;
    expect(summary.change).toBeNull();
  });
});
