import { describe, expect, it } from "vitest";
import { addDays, isWeekday } from "../dates";
import { ZERO, d } from "../decimal";
import { computeMonthlyReturns } from "../monthly";
import type { DailySeries, SeriesPoint } from "../series";
import type { DailyClose } from "../valuation";

// Rendimiento por mes (Inicio v2). Series armadas a mano: un punto por día hábil con retorno 0
// salvo los días indicados.

function makeSeries(
  baseDate: string,
  endDate: string,
  growth: Readonly<Record<string, string | null>>,
): DailySeries {
  const points: SeriesPoint[] = [];
  for (let day = addDays(baseDate, 1); day <= endDate; day = addDays(day, 1)) {
    if (!isWeekday(day)) continue;
    const g = day in growth ? growth[day] : "1";
    points.push({
      date: day,
      value: ZERO,
      cash: ZERO,
      marketValue: ZERO,
      flow: ZERO,
      growth: g === null || g === undefined ? null : d(g),
      unpriced: [],
    });
  }
  return { points, baseDate, unpricedSymbols: [], noBaseDays: 0 };
}

const closes = (rows: ReadonlyArray<readonly [string, string]>): DailyClose[] =>
  rows.map(([date, close]) => ({ date, close: d(close) }));

describe("computeMonthlyReturns", () => {
  // Base jueves 5/3/2026: la serie arranca a mitad de marzo. Marzo: +2 % el 10 y +3 % el 31
  // (martes, último día hábil) → 1,02 × 1,03 − 1 = 5,06 %. Abril: −1 % el 15 y +1 % el 30 →
  // 0,99 × 1,01 − 1 = −0,01 %. Mayo hasta el miércoles 6: +0,5 % el 5.
  const series = makeSeries("2026-03-05", "2026-05-06", {
    "2026-03-10": "1.02",
    "2026-03-31": "1.03",
    "2026-04-15": "0.99",
    "2026-04-30": "1.01",
    "2026-05-05": "1.005",
  });
  // Benchmark ajustado: 400 el día base; 420 fin de marzo; 441 fin de abril; 445,41 el 6/5.
  const spy = closes([
    ["2026-03-05", "400"],
    ["2026-03-31", "420"],
    ["2026-04-30", "441"],
    ["2026-05-06", "445.41"],
  ]);
  const months = computeMonthlyReturns(series, spy);

  it("un elemento por mes, en orden", () => {
    expect(months.map((m) => m.month)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
    ]);
  });

  it("el portafolio encadena los retornos diarios del mes", () => {
    expect(months.map((m) => m.portfolio!.toFixed())).toEqual([
      "0.0506",
      "-0.0001",
      "0.005",
    ]);
  });

  it("el benchmark compara el último cierre del mes con el del anterior (el primero, con el del día base)", () => {
    // 420 / 400 − 1 = 5 %; 441 / 420 − 1 = 5 %; 445,41 / 441 − 1 = 1 %.
    expect(months.map((m) => m.benchmark!.toFixed())).toEqual([
      "0.05",
      "0.05",
      "0.01",
    ]);
  });

  it("el primer mes arrancó a mitad de mes y el último está en curso", () => {
    expect(months.map((m) => m.startsMidMonth)).toEqual([true, false, false]);
    expect(months.map((m) => m.inProgress)).toEqual([false, false, true]);
  });
});

describe("meses completos", () => {
  it("si la serie arranca el primer día hábil del mes, el primer mes no es parcial", () => {
    // Base viernes 27/2/2026; primer punto lunes 2/3 (el 1/3 es domingo).
    const series = makeSeries("2026-02-27", "2026-03-31", {});
    const [march] = computeMonthlyReturns(series, null);
    expect(march!.startsMidMonth).toBe(false);
    // 31/3 es el último día hábil de marzo: el mes terminó.
    expect(march!.inProgress).toBe(false);
  });

  it("un mes cuyo último día hábil cae en fin de semana termina el viernes", () => {
    // 31/5/2026 es domingo → el mes termina el viernes 29.
    const done = makeSeries("2026-04-30", "2026-05-29", {});
    expect(computeMonthlyReturns(done, null)[0]!.inProgress).toBe(false);
    const running = makeSeries("2026-04-30", "2026-05-28", {});
    expect(computeMonthlyReturns(running, null)[0]!.inProgress).toBe(true);
  });
});

describe("datos que faltan", () => {
  it("sin benchmark, o con uno vacío, todos los meses lo traen en null", () => {
    const series = makeSeries("2026-03-05", "2026-04-10", {
      "2026-03-10": "1.02",
    });
    for (const benchmark of [null, []]) {
      expect(
        computeMonthlyReturns(series, benchmark).map((m) => m.benchmark),
      ).toEqual([null, null]);
    }
  });

  it("si el benchmark empieza después del día base no se inventa el primer mes", () => {
    const series = makeSeries("2026-03-05", "2026-04-10", {});
    const months = computeMonthlyReturns(
      series,
      closes([
        ["2026-03-20", "410"],
        ["2026-03-31", "420"],
        ["2026-04-10", "441"],
      ]),
    );
    expect(months[0]!.benchmark).toBeNull();
    // Abril sí: 441 / 420 − 1.
    expect(months[1]!.benchmark!.toFixed()).toBe("0.05");
  });

  it("un cierre de base en cero no da un rendimiento (ni infinito)", () => {
    const series = makeSeries("2026-03-05", "2026-03-31", {});
    const [march] = computeMonthlyReturns(
      series,
      closes([
        ["2026-03-05", "0"],
        ["2026-03-31", "420"],
      ]),
    );
    expect(march!.benchmark).toBeNull();
  });

  it("un benchmark desordenado da lo mismo", () => {
    const series = makeSeries("2026-03-05", "2026-04-10", {});
    const rows: Array<[string, string]> = [
      ["2026-03-05", "400"],
      ["2026-03-31", "420"],
      ["2026-04-10", "441"],
    ];
    expect(computeMonthlyReturns(series, closes(rows.toReversed()))).toEqual(
      computeMonthlyReturns(series, closes(rows)),
    );
  });

  it("un mes donde ningún día tuvo base positiva no tiene rendimiento del portafolio", () => {
    const growth: Record<string, string | null> = {};
    // Todo marzo sin base (por ejemplo, compras antes del primer depósito).
    for (let day = "2026-03-06"; day <= "2026-03-31"; day = addDays(day, 1))
      growth[day] = null;
    const series = makeSeries("2026-03-05", "2026-04-10", growth);
    const months = computeMonthlyReturns(series, null);
    expect(months[0]!.portfolio).toBeNull();
    expect(months[1]!.portfolio!.toFixed()).toBe("0");
  });

  it("una serie vacía no tiene meses", () => {
    expect(
      computeMonthlyReturns(
        { points: [], baseDate: null, unpricedSymbols: [], noBaseDays: 0 },
        null,
      ),
    ).toEqual([]);
  });
});
