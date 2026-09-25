import { describe, expect, it } from "vitest";
import {
  computePerformance,
  d,
  type DailyClose,
  type Transaction,
} from "@/lib/engine";
import { buy, deposit } from "@/lib/engine/__tests__/helpers";
import { benchmarkLabel, buildPerformanceView } from "../performance-view";

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string) => value.replace(/[  ]/g, " ");

const closes = (rows: ReadonlyArray<readonly [string, string]>): DailyClose[] =>
  rows.map(([date, close]) => ({ date, close: d(close) }));

// El escenario del criterio de terminado: depósito a mitad de período, TWR = 21 %.
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
const spy = closes([
  ["2026-09-18", "400"],
  ["2026-09-21", "404"],
  ["2026-09-22", "408"],
  ["2026-09-23", "412"],
  ["2026-09-24", "420"],
]);

function view(benchmark: DailyClose[] | null, symbol: string | null = "SPY") {
  const result = computePerformance({
    transactions,
    closes: new Map([["VOO", voo]]),
    benchmark,
    endDate: "2026-09-24",
  });
  return buildPerformanceView({ result, benchmark, benchmarkSymbol: symbol })!;
}

describe("buildPerformanceView", () => {
  const full = view(spy);
  const max = full.periods.find((p) => p.id === "MAX")!;

  it("un período por cada uno de los seis, con su rótulo", () => {
    expect(full.periods.map((p) => [p.id, p.label])).toEqual([
      ["1S", "1S"],
      ["1M", "1M"],
      ["3M", "3M"],
      ["YTD", "YTD"],
      ["1A", "1A"],
      ["MAX", "Todo"],
    ]);
  });

  it("los datos de Todo, formateados en es-UY y con su tono", () => {
    expect(plain(max.twr.text)).toBe("+21,00%");
    expect(max.twr.tone).toBe("gain");
    expect(plain(max.benchmark.text)).toBe("+5,00%");
    expect(max.benchmark.tone).toBe("gain");
    expect(plain(max.difference.text)).toBe("+16,00 pp");
    expect(max.difference.tone).toBe("gain");
  });

  it("6 días son muy pocos para una tasa anual: sin XIRR y con el motivo", () => {
    expect(max.xirr).toEqual({ text: "—", tone: null });
    expect(max.xirrHint).toBe("Muy corto para una tasa anual");
    expect(max.twrAnnualized).toBeNull();
  });

  it("desde cuándo cuenta: el primer día para Todo y para un período recortado", () => {
    expect(max.since).toBe("21/09/2026");
    for (const period of full.periods) {
      expect(period.truncated || period.id === "MAX").toBe(true);
      expect(period.since).toBe("21/09/2026");
    }
  });

  it("las curvas: base 100, valor y benchmark en base 100, como number para dibujar", () => {
    expect(max.points.map((p) => p.date)).toEqual([
      "2026-09-18",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    expect(max.points.map((p) => p.portfolio)).toEqual([
      100, 100, 110, 110, 121,
    ]);
    expect(max.points.map((p) => p.value)).toEqual([
      null,
      1000,
      1100,
      2200,
      2420,
    ]);
    expect(max.points.map((p) => p.benchmark)).toEqual([
      100, 101, 102, 103, 105,
    ]);
  });

  it("fecha del último cierre y benchmark con nombre de persona", () => {
    expect(full.asOf).toBe("24/09/2026");
    expect(full.benchmarkLabel).toBe("S&P 500");
    expect(full.hasBenchmark).toBe(true);
    expect(full.notes).toEqual([]);
  });

  it("sin benchmark: sus datos quedan en blanco y el resto sigue", () => {
    const without = view(null);
    const m = without.periods.find((p) => p.id === "MAX")!;
    expect(without.hasBenchmark).toBe(false);
    expect(m.benchmark).toEqual({ text: "—", tone: null });
    expect(m.difference).toEqual({ text: "—", tone: null });
    expect(plain(m.twr.text)).toBe("+21,00%");
    expect(m.points.every((p) => p.benchmark === null)).toBe(true);
  });

  it("un rendimiento negativo lleva tono de pérdida y uno que redondea a cero, 'sin cambio'", () => {
    const flat = computePerformance({
      transactions: [deposit("2026-09-21T15:00:00Z", "500")],
      closes: new Map(),
      benchmark: closes([
        ["2026-09-18", "400"],
        ["2026-09-24", "380"],
      ]),
      endDate: "2026-09-24",
    });
    const v = buildPerformanceView({
      result: flat,
      benchmark: closes([
        ["2026-09-18", "400"],
        ["2026-09-24", "380"],
      ]),
      benchmarkSymbol: "SPY",
    })!;
    const m = v.periods.find((p) => p.id === "MAX")!;
    expect(plain(m.twr.text)).toBe("0,00%");
    expect(m.twr.tone).toBe("flat");
    expect(plain(m.benchmark.text)).toBe("-5,00%");
    expect(m.benchmark.tone).toBe("loss");
    expect(plain(m.difference.text)).toBe("+5,00 pp");
  });

  it("los avisos se redactan en español", () => {
    const result = computePerformance({
      transactions: [
        buy("2026-09-21T15:00:00Z", "NEW", "1", "100"),
        deposit("2026-09-22T15:00:00Z", "200"),
      ],
      closes: new Map(),
      benchmark: null,
      endDate: "2026-09-22",
    });
    const v = buildPerformanceView({
      result,
      benchmark: null,
      benchmarkSymbol: "SPY",
    })!;
    expect(v.notes).toEqual([
      "Faltan precios históricos de NEW en algunos días: esos días se valuaron a costo.",
      "Hay 1 día sin base para calcular el rendimiento (por ejemplo, una compra antes del primer depósito): no cuenta.",
    ]);
  });

  it("sin serie no hay vista", () => {
    const empty = computePerformance({
      transactions: [],
      closes: new Map(),
      benchmark: null,
      endDate: "2026-09-24",
    });
    expect(
      buildPerformanceView({
        result: empty,
        benchmark: null,
        benchmarkSymbol: "SPY",
      }),
    ).toBeNull();
  });
});

describe("períodos más largos con XIRR y TWR anualizado", () => {
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
  const v = buildPerformanceView({
    result,
    benchmark: null,
    benchmarkSymbol: "SPY",
  })!;

  it("Todo (368 días): TWR anualizado y XIRR presentes; 1A (365 días): sin anualizar", () => {
    const max = v.periods.find((p) => p.id === "MAX")!;
    expect(plain(max.twr.text)).toBe("+21,00%");
    expect(max.twrAnnualized).not.toBeNull();
    // 1,21^(365/368) − 1 ≈ 20,81 %
    expect(plain(max.twrAnnualized!.text)).toBe("+20,81%");
    expect(max.xirr.tone).toBe("gain");

    const year = v.periods.find((p) => p.id === "1A")!;
    expect(year.twrAnnualized).toBeNull();
    expect(plain(year.xirr.text)).toBe("+21,00%");
    expect(year.xirrHint).toBeNull();
    expect(year.since).toBe("05/01/2026"); // no recortado: cuenta desde su día base
    expect(year.truncated).toBe(false);
  });
});

describe("benchmarkLabel", () => {
  it("SPY es el S&P 500; otro símbolo, tal cual; sin símbolo, genérico", () => {
    expect(benchmarkLabel("SPY")).toBe("S&P 500");
    expect(benchmarkLabel("QQQ")).toBe("QQQ");
    expect(benchmarkLabel(null)).toBe("Benchmark");
  });
});

describe("ganancia en dinero (Inicio v2)", () => {
  const full = view(spy);
  const max = full.periods.find((p) => p.id === "MAX")!;

  it("la ganancia del período va con signo y tono: 2420 − 2100 = +US$ 320", () => {
    expect(plain(max.gain.text)).toBe("+US$ 320,00");
    expect(max.gain.tone).toBe("gain");
  });

  it("la curva de ganancia arranca en 0 y no salta con los depósitos", () => {
    expect(max.points.map((p) => p.gain)).toEqual([0, 0, 100, 100, 320]);
  });
});

describe("rendimiento por mes (Inicio v2)", () => {
  const full = view(spy);

  it("un mes con sus porcentajes para dibujar y sus textos: +21 % contra +5 %", () => {
    expect(full.monthly).toHaveLength(1);
    const [september] = full.monthly;
    expect(september).toMatchObject({
      month: "2026-09",
      label: "set",
      title: "Setiembre de 2026",
      portfolio: 21,
      benchmark: 5,
      portfolioTone: "gain",
      benchmarkTone: "gain",
    });
    expect(plain(september!.portfolioText)).toBe("+21,00%");
    expect(plain(september!.benchmarkText)).toBe("+5,00%");
  });

  it("avisa que el mes arrancó a mitad y que sigue en curso", () => {
    expect(full.monthly[0]!.note).toBe("desde el 21/09, en curso");
  });

  it("sin benchmark, las barras del S&P quedan vacías", () => {
    const [september] = view(null).monthly;
    expect(september!.benchmark).toBeNull();
    expect(september!.benchmarkText).toBe("—");
    expect(september!.benchmarkTone).toBeNull();
    expect(september!.portfolio).toBe(21);
  });
});

describe("riesgo (Inicio v2)", () => {
  it("un índice que solo sube: sin caídas, en máximos y con poca historia", () => {
    const risk = view(spy).risk!;
    expect(risk.maxDrawdown).toEqual({ text: "Sin caídas", tone: "flat" });
    expect(risk.maxDrawdownDetail).toBeNull();
    expect(risk.currentDrawdown).toEqual({ text: "En máximos", tone: "gain" });
    expect(risk.days).toBe(4);
    // 4 días no alcanzan para una volatilidad.
    expect(risk.volatility).toEqual({ text: "—", tone: null });
    expect(risk.volatilityHint).toBe("Hacen falta 20 días con datos (hay 4)");
    expect(risk.since).toBe("21/09/2026");
    expect(risk.note).toBe(
      "Con menos de un año de historia estos números son orientativos.",
    );
    // Mejor día: +10 % el 22 (el 24 también; gana el primero).
    expect(plain(risk.bestDay.text)).toBe("+10,00%");
    expect(risk.bestDayDate).toBe("22/09/2026");
    expect(risk.curve.map((p) => p.drawdown)).toEqual([0, 0, 0, 0, 0]);
  });

  it("una caída de 10 % desde el máximo, sin recuperar", () => {
    // Depósito 1000 y compra de 10 a 100. Cierres: 100, 110, 99, 105 → valores 1000, 1100, 990,
    // 1050. Índice 100, 100, 110, 99, 105. Máximo 110 (22/9), mínimo 99 (23/9): −10 %.
    // Al final 105 / 110 − 1 = −4,545 %.
    const result = computePerformance({
      transactions: [
        deposit("2026-09-21T15:00:00Z", "1000"),
        buy("2026-09-21T15:00:00Z", "VOO", "10", "100"),
      ],
      closes: new Map([
        [
          "VOO",
          closes([
            ["2026-09-21", "100"],
            ["2026-09-22", "110"],
            ["2026-09-23", "99"],
            ["2026-09-24", "105"],
          ]),
        ],
      ]),
      benchmark: null,
      endDate: "2026-09-24",
    });
    const risk = buildPerformanceView({
      result,
      benchmark: null,
      benchmarkSymbol: null,
    })!.risk!;
    expect(plain(risk.maxDrawdown.text)).toBe("-10,00%");
    expect(risk.maxDrawdown.tone).toBe("loss");
    expect(risk.maxDrawdownDetail).toBe("22/09 → 23/09 · sin recuperar");
    expect(plain(risk.currentDrawdown.text)).toBe("-4,55%");
    expect(risk.currentDrawdown.tone).toBe("loss");
    expect(plain(risk.worstDay.text)).toBe("-10,00%");
    expect(risk.worstDayDate).toBe("23/09/2026");
    expect(risk.curve.map((p) => Math.round(p.drawdown * 1e6) / 1e6)).toEqual([
      0, 0, 0, -10, -4.545455,
    ]);
  });
});
