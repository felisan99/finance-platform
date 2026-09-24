import { describe, expect, it } from "vitest";
import { d, type Dec } from "../decimal";
import {
  MIN_XIRR_DAYS,
  PERIOD_IDS,
  computePerformance,
  periodBase,
  periodCurve,
  type PeriodId,
  type PeriodResult,
} from "../performance";
import type { Transaction } from "../types";
import type { DailyClose } from "../valuation";
import { buy, deposit } from "./helpers";

const closes = (rows: ReadonlyArray<readonly [string, string]>): DailyClose[] =>
  rows.map(([date, close]) => ({ date, close: d(close) }));

const num = (value: Dec | null): number => (value as Dec).toNumber();

const byId = (periods: readonly PeriodResult[], id: PeriodId): PeriodResult => {
  const found = periods.find((p) => p.id === id);
  if (!found) throw new Error(`sin período ${id}`);
  return found;
};

describe("periodBase", () => {
  const HISTORY = "2020-01-02"; // historial muy anterior: nada se recorta
  // 2026-09-24 es jueves.
  const cases: Array<[PeriodId, string]> = [
    ["1S", "2026-09-17"], // 7 días antes (jueves)
    ["1M", "2026-08-24"], // mismo día del mes anterior (lunes)
    ["3M", "2026-06-24"],
    ["1A", "2025-09-24"],
    ["YTD", "2025-12-31"], // último día del año anterior (miércoles)
    ["MAX", HISTORY],
  ];
  it.each(cases)("%s desde el jueves 2026-09-24", (id, base) => {
    expect(periodBase(id, "2026-09-24", HISTORY)).toEqual({
      baseDate: base,
      truncated: false,
    });
  });

  it("un inicio nominal de fin de semana retrocede al viernes (28/02/2026 es sábado)", () => {
    // 31/03 − 1 mes = 28/02 (tope a fin de mes), que es sábado → viernes 27.
    expect(periodBase("1M", "2026-03-31", HISTORY).baseDate).toBe("2026-02-27");
  });

  it("YTD a principios de año usa el cierre del 31/12 (viernes aunque sea feriado)", () => {
    expect(periodBase("YTD", "2027-01-05", HISTORY).baseDate).toBe(
      "2026-12-31",
    );
    // 31/12/2027 es viernes; 31/12/2028 es domingo → viernes 29.
    expect(periodBase("YTD", "2029-01-04", HISTORY).baseDate).toBe(
      "2028-12-29",
    );
  });

  it("si el historial es más corto que el período, se recorta al inicio del historial", () => {
    expect(periodBase("1A", "2026-09-24", "2026-03-05")).toEqual({
      baseDate: "2026-03-05",
      truncated: true,
    });
    expect(periodBase("1M", "2026-09-24", "2026-03-05").truncated).toBe(false);
    // Exactamente igual al inicio: no cuenta como recorte.
    expect(periodBase("1M", "2026-09-24", "2026-08-24")).toEqual({
      baseDate: "2026-08-24",
      truncated: false,
    });
  });
});

describe("computePerformance: depósito a mitad de período (criterio de terminado)", () => {
  // Lun 21: depósito 1000 y compra de 10 a 100. Mar 22: 110 (+10 %). Mié 23: depósito 1100 y
  // compra de 10 más a 110. Jue 24: 121 (+10 %). TWR = 1,1 × 1 × 1,1 − 1 = 21 %.
  // (El retorno ponderado por dinero es otra cosa: 320 de ganancia sobre 2100 aportados, donde
  //  la mitad del dinero estuvo invertida un solo día.)
  const transactions: Transaction[] = [
    deposit("2026-09-21T15:00:00Z", "1000"),
    buy("2026-09-21T15:00:00Z", "VOO", "10", "100"),
    deposit("2026-09-23T15:00:00Z", "1100"),
    buy("2026-09-23T15:00:00Z", "VOO", "10", "110"),
  ];
  const voo = closes([
    ["2026-09-21", "100"],
    ["2026-09-22", "110"],
    ["2026-09-23", "110"],
    ["2026-09-24", "121"],
  ]);
  // SPY ajustado: de 400 (viernes 18, el día base) a 420 (jueves 24) = +5 %.
  const spy = closes([
    ["2026-09-18", "400"],
    ["2026-09-21", "404"],
    ["2026-09-22", "408"],
    ["2026-09-23", "412"],
    ["2026-09-24", "420"],
  ]);
  const result = computePerformance({
    transactions,
    closes: new Map([["VOO", voo]]),
    benchmark: spy,
    endDate: "2026-09-24",
  });
  const max = byId(result.periods, "MAX");

  it("TWR = 21 %", () => {
    expect(max.twr!.toFixed()).toBe("0.21");
  });

  it("benchmark = +5 % y diferencia = 16 puntos", () => {
    expect(max.benchmarkReturn!.toFixed()).toBe("0.05");
    expect(max.difference!.toFixed()).toBe("0.16");
  });

  it("fechas del período: base = viernes anterior, empieza el lunes, termina el jueves", () => {
    expect(max.baseDate).toBe("2026-09-18");
    expect(max.startDate).toBe("2026-09-21");
    expect(max.endDate).toBe("2026-09-24");
    expect(max.days).toBe(6);
    expect(max.truncated).toBe(false);
  });

  it("6 días son menos que MIN_XIRR_DAYS: sin XIRR ni TWR anualizado", () => {
    expect(MIN_XIRR_DAYS).toBe(30);
    expect(max.xirr).toBeNull();
    expect(max.twrAnnualized).toBeNull();
  });

  it("todos los períodos existen, en orden, y los más largos que el historial se recortan a Todo", () => {
    expect(result.periods.map((p) => p.id)).toEqual([...PERIOD_IDS]);
    for (const id of ["1S", "1M", "3M", "YTD", "1A"] as const) {
      const period = byId(result.periods, id);
      expect(period.truncated).toBe(true);
      expect(period.baseDate).toBe("2026-09-18");
      expect(period.twr!.toFixed()).toBe("0.21");
    }
  });

  it("sin avisos", () => {
    expect(result.warnings).toEqual([]);
  });

  it("curva de Todo: arranca en 100 en el día base y termina en 100 × (1 + TWR)", () => {
    const curve = periodCurve(result.series, spy, max);
    expect(curve.map((p) => p.date)).toEqual([
      "2026-09-18",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    // El día base todavía no había portafolio: sin valor.
    expect(curve[0]!.value).toBeNull();
    expect(curve.map((p) => p.portfolio.toFixed())).toEqual([
      "100",
      "100",
      "110",
      "110",
      "121",
    ]);
    expect(curve.at(-1)!.portfolio.toFixed()).toBe(
      max.twr!.plus(1).times(100).toFixed(),
    );
    expect(curve.map((p) => p.value?.toFixed() ?? null)).toEqual([
      null,
      "1000",
      "1100",
      "2200",
      "2420",
    ]);
    // Benchmark en base 100 sobre el cierre del 18 (400): 404 → 101, 408 → 102, 412 → 103, 420 → 105.
    expect(curve.map((p) => p.benchmark!.toFixed())).toEqual([
      "100",
      "101",
      "102",
      "103",
      "105",
    ]);
  });

  it("curva de un período con base dentro de la serie: valor del día base y re-normalización", () => {
    const curve = periodCurve(result.series, spy, {
      baseDate: "2026-09-22",
      endDate: "2026-09-24",
    });
    expect(curve.map((p) => p.date)).toEqual([
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    expect(curve[0]!.value!.toFixed()).toBe("1100");
    // Desde el cierre del 22: el 23 no cambia (×1) y el 24 sube 10 % (×1,1).
    expect(curve.map((p) => p.portfolio.toFixed())).toEqual([
      "100",
      "100",
      "110",
    ]);
    // SPY normalizado a 100 el 22 (408): 412 / 408 y 420 / 408.
    expect(num(curve[1]!.benchmark)).toBeCloseTo((412 / 408) * 100, 8);
    expect(num(curve[2]!.benchmark)).toBeCloseTo((420 / 408) * 100, 8);
  });
});

describe("computePerformance: XIRR y anualización", () => {
  it("medio año: XIRR = 1,1^(365/182) − 1 y TWR de 10 %; los períodos con base dentro de la serie usan su propio inicio", () => {
    // Lun 05/01/2026: depósito de 1000 y compra de 10 a 100. Sin más cierres hasta el lunes
    // 06/07/2026 (110): el valor queda plano en 1000 y el último día sube 10 %.
    const result = computePerformance({
      transactions: [
        deposit("2026-01-05T15:00:00Z", "1000"),
        buy("2026-01-05T15:00:00Z", "VOO", "10", "100"),
      ],
      closes: new Map([
        [
          "VOO",
          closes([
            ["2026-01-05", "100"],
            ["2026-07-06", "110"],
          ]),
        ],
      ]),
      benchmark: null,
      endDate: "2026-07-06",
    });

    const max = byId(result.periods, "MAX");
    expect(max.twr!.toFixed()).toBe("0.1");
    // Flujos: −1000 el 05/01 y +1100 el 06/07: 182 días (31+28+31+30+31+30+... = 182).
    expect(num(max.xirr)).toBeCloseTo(Math.pow(1.1, 365 / 182) - 1, 9);
    expect(max.twrAnnualized).toBeNull(); // 184 días: no supera un año

    // 3M: base = 06/04/2026 (lunes), valor 1000 → flujos −1000 y +1100 con 91 días.
    const threeMonths = byId(result.periods, "3M");
    expect(threeMonths.baseDate).toBe("2026-04-06");
    expect(threeMonths.days).toBe(91);
    expect(threeMonths.twr!.toFixed()).toBe("0.1");
    expect(num(threeMonths.xirr)).toBeCloseTo(Math.pow(1.1, 365 / 91) - 1, 9);

    // 1M: 06/06/2026 es sábado → base viernes 05/06 (31 días): justo sobre el umbral de 30.
    const oneMonth = byId(result.periods, "1M");
    expect(oneMonth.baseDate).toBe("2026-06-05");
    expect(oneMonth.days).toBe(31);
    expect(num(oneMonth.xirr)).toBeCloseTo(Math.pow(1.1, 365 / 31) - 1, 8);

    // 1S: 7 días, por debajo del umbral: sin XIRR aunque haya TWR.
    const oneWeek = byId(result.periods, "1S");
    expect(oneWeek.days).toBe(7);
    expect(oneWeek.twr!.toFixed()).toBe("0.1");
    expect(oneWeek.xirr).toBeNull();

    // YTD y 1A empezarían antes del historial: se recortan a Todo.
    expect(byId(result.periods, "YTD").truncated).toBe(true);
    expect(byId(result.periods, "1A").truncated).toBe(true);
    expect(byId(result.periods, "YTD").baseDate).toBe(max.baseDate);
  });

  it("más de un año: el TWR se anualiza; con exactamente 365 días, no (y XIRR = TWR)", () => {
    // Lun 05/01/2026 depósito 1000 y 10 a 100; mar 05/01/2027 cierre 121 (V = 1210).
    const result = computePerformance({
      transactions: [
        deposit("2026-01-05T15:00:00Z", "1000"),
        buy("2026-01-05T15:00:00Z", "VOO", "10", "100"),
      ],
      closes: new Map([
        [
          "VOO",
          closes([
            ["2026-01-05", "100"],
            ["2027-01-05", "121"],
          ]),
        ],
      ]),
      benchmark: null,
      endDate: "2027-01-05",
    });

    // Todo: base viernes 02/01/2026 → 368 días.
    const max = byId(result.periods, "MAX");
    expect(max.days).toBe(368);
    expect(max.twr!.toFixed()).toBe("0.21");
    expect(num(max.twrAnnualized)).toBeCloseTo(
      Math.pow(1.21, 365 / 368) - 1,
      9,
    );

    // 1A: base lunes 05/01/2026 → exactamente 365 días: no se anualiza.
    const year = byId(result.periods, "1A");
    expect(year.baseDate).toBe("2026-01-05");
    expect(year.days).toBe(365);
    expect(year.twr!.toFixed()).toBe("0.21");
    expect(year.twrAnnualized).toBeNull();
    // Un solo aporte (el valor del día base) y 365 días: la tasa anual es el retorno simple.
    expect(num(year.xirr)).toBeCloseTo(0.21, 9);
  });
});

describe("computePerformance: XIRR con un aporte intermedio", () => {
  // Lun 05/01/2026: depósito 1000 y compra de 10 a 100. Lun 06/07/2026 (182 días después): depósito
  // 500 y compra de 5 a 100. Lun 04/01/2027 (364 días desde el inicio): cierre a 120 → 15 × 120 = 1800.
  // Flujos: −1000 (año 0), −500 (182/365) y +1800 (364/365). La tasa se busca acá con una bisección
  // propia, independiente del algoritmo del motor.
  const result = computePerformance({
    transactions: [
      deposit("2026-01-05T15:00:00Z", "1000"),
      buy("2026-01-05T15:00:00Z", "VOO", "10", "100"),
      deposit("2026-07-06T15:00:00Z", "500"),
      buy("2026-07-06T15:00:00Z", "VOO", "5", "100"),
    ],
    closes: new Map([
      [
        "VOO",
        closes([
          ["2026-01-05", "100"],
          ["2026-07-06", "100"],
          ["2027-01-04", "120"],
        ]),
      ],
    ]),
    benchmark: null,
    endDate: "2027-01-04",
  });

  it("XIRR con un aporte en el medio: el valor final y el aporte entran con su signo y su fecha", () => {
    const npv = (r: number) =>
      -1000 -
      500 * Math.pow(1 + r, -182 / 365) +
      1800 * Math.pow(1 + r, -364 / 365);
    let low = -0.5;
    let high = 2;
    for (let i = 0; i < 200; i++) {
      const mid = (low + high) / 2;
      if (npv(low) * npv(mid) <= 0) high = mid;
      else low = mid;
    }
    const expected = (low + high) / 2;
    expect(expected).toBeGreaterThan(0.1); // sanity: es una ganancia
    expect(num(byId(result.periods, "MAX").xirr)).toBeCloseTo(expected, 9);
  });

  it("el TWR de ese caso ignora el aporte: 120 / 100 − 1 = 20 %", () => {
    expect(byId(result.periods, "MAX").twr!.toFixed()).toBe("0.2");
  });
});

describe("computePerformance: el borde de MIN_XIRR_DAYS", () => {
  // Primera operación el miércoles 04/03/2026 → base martes 03/03. Con cierre el jueves 02/04
  // son exactamente 30 días; el miércoles 01/04, 29.
  const build = (endDate: string) =>
    byId(
      computePerformance({
        transactions: [
          deposit("2026-03-04T15:00:00Z", "1000"),
          buy("2026-03-04T15:00:00Z", "VOO", "10", "100"),
        ],
        closes: new Map([
          [
            "VOO",
            closes([
              ["2026-03-04", "100"],
              [endDate, "110"],
            ]),
          ],
        ]),
        benchmark: null,
        endDate,
      }).periods,
      "MAX",
    );

  it("30 días ya alcanzan; 29 no", () => {
    const thirty = build("2026-04-02");
    expect(thirty.days).toBe(30);
    expect(thirty.xirr).not.toBeNull();
    const twentyNine = build("2026-04-01");
    expect(twentyNine.days).toBe(29);
    expect(twentyNine.xirr).toBeNull();
  });
});

describe("computePerformance: benchmark", () => {
  const base = {
    transactions: [
      deposit("2026-09-21T15:00:00Z", "1000"),
      buy("2026-09-21T15:00:00Z", "VOO", "10", "100"),
    ] as Transaction[],
    closes: new Map([
      [
        "VOO",
        closes([
          ["2026-09-21", "100"],
          ["2026-09-24", "110"],
        ]),
      ],
    ]),
    endDate: "2026-09-24",
  };

  it("sin benchmark: no hay retorno ni diferencia y se avisa", () => {
    const result = computePerformance({ ...base, benchmark: null });
    const max = byId(result.periods, "MAX");
    expect(max.twr!.toFixed()).toBe("0.1");
    expect(max.benchmarkReturn).toBeNull();
    expect(max.difference).toBeNull();
    expect(result.warnings).toEqual([{ code: "NO_BENCHMARK" }]);
    // Una lista vacía es lo mismo que no tener.
    expect(computePerformance({ ...base, benchmark: [] }).warnings).toEqual([
      { code: "NO_BENCHMARK" },
    ]);
  });

  it("si el benchmark empieza después del día base no se inventa un retorno", () => {
    const result = computePerformance({
      ...base,
      benchmark: closes([
        ["2026-09-22", "400"],
        ["2026-09-24", "420"],
      ]),
    });
    expect(byId(result.periods, "MAX").benchmarkReturn).toBeNull();
    // La curva tampoco tiene benchmark.
    expect(
      periodCurve(
        result.series,
        closes([["2026-09-22", "400"]]),
        byId(result.periods, "MAX"),
      ).map((p) => p.benchmark),
    ).toEqual([null, null, null, null, null]);
  });

  it("usa el último cierre conocido en o antes del día base y del final (rueda sin dato)", () => {
    // Base = viernes 18 (sin dato): se usa el jueves 17 (400). El final, jueves 24 sin dato: el miércoles 23 (440).
    const result = computePerformance({
      ...base,
      benchmark: closes([
        ["2026-09-17", "400"],
        ["2026-09-23", "440"],
      ]),
    });
    expect(byId(result.periods, "MAX").benchmarkReturn!.toFixed()).toBe("0.1");
  });

  it("un benchmark desordenado da lo mismo", () => {
    const rows: Array<[string, string]> = [
      ["2026-09-18", "400"],
      ["2026-09-21", "404"],
      ["2026-09-24", "420"],
    ];
    const sorted = computePerformance({ ...base, benchmark: closes(rows) });
    const shuffled = computePerformance({
      ...base,
      benchmark: closes([rows[2]!, rows[0]!, rows[1]!]),
    });
    expect(byId(shuffled.periods, "MAX").benchmarkReturn!.toFixed()).toBe(
      byId(sorted.periods, "MAX").benchmarkReturn!.toFixed(),
    );
  });
});

describe("computePerformance: avisos y casos límite", () => {
  it("una posición sin precio y días sin base se avisan", () => {
    const result = computePerformance({
      transactions: [
        buy("2026-09-21T15:00:00Z", "NEW", "1", "100"),
        deposit("2026-09-22T15:00:00Z", "200"),
      ],
      closes: new Map(),
      benchmark: closes([
        ["2026-09-18", "400"],
        ["2026-09-22", "404"],
      ]),
      endDate: "2026-09-22",
    });
    expect(result.warnings).toEqual([
      { code: "UNPRICED_POSITION", symbols: ["NEW"] },
      { code: "NO_BASE_DAYS", days: 1 },
    ]);
  });

  it("sin operaciones no hay períodos", () => {
    const result = computePerformance({
      transactions: [],
      closes: new Map(),
      benchmark: null,
      endDate: "2026-09-24",
    });
    expect(result).toMatchObject({ periods: [], warnings: [] });
    expect(result.series.points).toEqual([]);
  });

  it("un depósito sin nada más: TWR 0 % (no null) y el valor no se mueve", () => {
    const result = computePerformance({
      transactions: [deposit("2026-09-21T15:00:00Z", "500")],
      closes: new Map(),
      benchmark: null,
      endDate: "2026-09-25",
    });
    const max = byId(result.periods, "MAX");
    expect(max.twr!.toFixed()).toBe("0");
    expect(max.xirr).toBeNull();
  });
});
