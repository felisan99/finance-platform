import { describe, expect, it } from "vitest";
import { weekdaysBetween } from "../dates";
import { d, type Dec } from "../decimal";
import {
  computePerformance,
  periodCurve,
  type CurvePoint,
  type PeriodResult,
} from "../performance";
import type { DailyClose } from "../valuation";
import { buy, deposit, sell, withdrawal } from "./helpers";

// Coherencia entre períodos: cada período re-normaliza su curva en su propio día base, así que la
// forma de un gráfico cambia al cambiar de período (y el portafolio puede ir arriba del benchmark
// en 1A y abajo en 1M). Lo que NO puede cambiar es el movimiento de un día a otro: dentro de la
// parte que comparten, la curva de un período corto es la del largo re-escalada en su día base.

const DAYS = weekdaysBetween("2025-05-01", "2026-09-30");

/** Caminata pseudoaleatoria determinista (sin `Math.random`: el test tiene que dar siempre lo mismo). */
function walk(seed: number, start: number, drift: number): DailyClose[] {
  let state = seed;
  let price = start;
  return DAYS.map((date) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    const shock = (state / 2147483648 - 0.5) * 0.04;
    price = price * (1 + drift + shock);
    return { date, close: d(price.toFixed(4)) };
  });
}

const AAA = walk(7, 100, 0.0012);
const BBB = walk(11, 50, -0.0004);
const SPY = walk(23, 500, 0.0005);
const closeOf = (series: DailyClose[], date: string) =>
  series.find((c) => c.date === date)!.close.toFixed();

// Depósitos y retiros en el medio de los períodos cortos: el TWR no puede confundirlos con ganancia.
const result = computePerformance({
  transactions: [
    deposit("2025-06-02T15:00:00Z", "10000"),
    buy("2025-06-02T15:00:00Z", "AAA", "50", closeOf(AAA, "2025-06-02")),
    buy("2025-06-03T15:00:00Z", "BBB", "60", closeOf(BBB, "2025-06-03")),
    deposit("2026-02-10T15:00:00Z", "5000"),
    buy("2026-02-10T15:00:00Z", "BBB", "40", closeOf(BBB, "2026-02-10")),
    sell("2026-09-08T15:00:00Z", "AAA", "10", closeOf(AAA, "2026-09-08")),
    deposit("2026-09-17T15:00:00Z", "2000"),
    withdrawal("2026-09-25T15:00:00Z", "1500"),
  ],
  closes: new Map([
    ["AAA", AAA],
    ["BBB", BBB],
  ]),
  benchmark: SPY,
  endDate: "2026-09-30",
});

const curves = result.periods.map((period) => ({
  period,
  curve: periodCurve(result.series, SPY, period),
}));

const ratio = (a: Dec, b: Dec) => a.div(b).toNumber();

describe("periodCurve: coherencia entre períodos", () => {
  it("hay seis períodos, cada uno con su propio día base y ninguno recortado", () => {
    expect(result.periods.map((p) => p.id)).toEqual([
      "1S",
      "1M",
      "3M",
      "YTD",
      "1A",
      "MAX",
    ]);
    expect(result.periods.every((p) => !p.truncated)).toBe(true);
  });

  it("cada curva arranca en 100 y termina en 100 × (1 + TWR) y 100 × (1 + benchmark)", () => {
    for (const { period, curve } of curves) {
      const first = curve[0]!;
      const last = curve.at(-1)!;
      expect(first.date).toBe(period.baseDate);
      expect(first.portfolio.toNumber()).toBe(100);
      expect(first.benchmark!.toNumber()).toBe(100);
      expect(last.portfolio.toNumber()).toBeCloseTo(
        100 * (1 + period.twr!.toNumber()),
        8,
      );
      expect(last.benchmark!.toNumber()).toBeCloseTo(
        100 * (1 + period.benchmarkReturn!.toNumber()),
        8,
      );
    }
  });

  it("en lo que comparten, la curva corta es la larga re-escalada en el día base de la corta", () => {
    const pairs: Array<[PeriodResult, CurvePoint[], CurvePoint[]]> = [];
    for (const long of curves) {
      for (const short of curves) {
        if (short.period.baseDate > long.period.baseDate) {
          pairs.push([short.period, long.curve, short.curve]);
        }
      }
    }
    expect(pairs.length).toBeGreaterThanOrEqual(15);

    for (const [shortPeriod, longCurve, shortCurve] of pairs) {
      const longByDate = new Map(longCurve.map((p) => [p.date, p]));
      const anchor = longByDate.get(shortPeriod.baseDate)!;
      expect(anchor).toBeDefined();
      for (const point of shortCurve) {
        const same = longByDate.get(point.date)!;
        expect(point.portfolio.toNumber()).toBeCloseTo(
          100 * ratio(same.portfolio, anchor.portfolio),
          8,
        );
        expect(point.benchmark!.toNumber()).toBeCloseTo(
          100 * ratio(same.benchmark!, anchor.benchmark!),
          8,
        );
        // La ganancia en dinero se corre (no se escala) y el valor es el mismo.
        expect(point.gain.toNumber()).toBeCloseTo(
          same.gain.minus(anchor.gain).toNumber(),
          6,
        );
        expect(point.value?.toFixed()).toBe(same.value?.toFixed());
      }
    }
  });

  it("la diferencia contra el benchmark tiene el signo de la distancia entre los finales de las curvas", () => {
    for (const { period, curve } of curves) {
      const last = curve.at(-1)!;
      const gap = last.portfolio.minus(last.benchmark!);
      expect(Math.sign(gap.toNumber())).toBe(
        Math.sign(period.difference!.toNumber()),
      );
    }
  });
});
