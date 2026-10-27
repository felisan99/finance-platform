import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, isWeekday } from "../dates";
import { d, type Dec } from "../decimal";
import { computeEngine } from "../engine";
import { annualizedVolatilityOf } from "../risk";
import { valuePortfolio, type DailyClose, type PriceInfo } from "../valuation";
import {
  MIN_SHARED_DAYS,
  alignReturns,
  analyzeFit,
  correlation,
  priceDrawdown,
  simulateAddition,
  simulateMonthlyPlan,
  typicalMonthlyDeposit,
  volatilityModel,
  type VolatilityModel,
} from "../what-if";
import { buy, cashTx, deposit, dividend, expectDec } from "./helpers";

// «Antes de comprar»: composición antes y después, parecido y volatilidad, aporte mensual y caída
// del precio. Los vectores son a mano.

const closes = (pairs: ReadonlyArray<[string, string]>): DailyClose[] =>
  pairs.map(([date, close]) => ({ date, close: d(close) }));

/** Días hábiles consecutivos desde `start` (incluido) con los cierres dados. */
function weekdaySeries(start: string, values: readonly number[]): DailyClose[] {
  const out: DailyClose[] = [];
  let day = start;
  for (const value of values) {
    while (!isWeekday(day)) day = addDays(day, 1);
    out.push({ date: day, close: d(value.toFixed(6)) });
    day = addDays(day, 1);
  }
  return out;
}

/** Cierres a partir de retornos diarios (fracción), arrancando en 100. */
function fromReturns(start: string, returns: readonly number[]): DailyClose[] {
  const values = [100];
  for (const r of returns) values.push((values.at(-1) as number) * (1 + r));
  return weekdaySeries(start, values);
}

/** Retornos pseudoaleatorios reproducibles (sin depender de Math.random). */
function noise(seed: number, n: number): number[] {
  let state = seed;
  return Array.from({ length: n }, () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return (state / 2147483648 - 0.5) * 0.04;
  });
}

function price(value: string): PriceInfo {
  return {
    price: d(value),
    asOf: new Date("2026-09-25T21:00:00Z"),
    source: "close",
    previousClose: null,
  };
}

/** AAPL 10 × 100, VOO 5 × 400 y US$ 1.000 de efectivo: total 4.000. */
function portfolio(
  extra: { cash?: string; prices?: Record<string, string> } = {},
) {
  const txs = [
    deposit("2026-01-02T15:00:00Z", extra.cash ?? "4000"),
    buy("2026-01-05T15:00:00Z", "AAPL", "10", "100"),
    buy("2026-01-05T15:00:00Z", "VOO", "5", "400"),
  ];
  const prices = new Map<string, PriceInfo>(
    Object.entries(extra.prices ?? { AAPL: "100", VOO: "400" }).map(
      ([symbol, value]) => [symbol, price(value)],
    ),
  );
  return valuePortfolio(computeEngine(txs), prices);
}

const SECTORS: Record<string, string> = {
  AAPL: "Technology",
  NVDA: "Technology",
  VOO: "ETF",
  XOM: "Energy",
};
const groupOf = (symbol: string) => SECTORS[symbol] ?? null;

describe("typicalMonthlyDeposit", () => {
  const TODAY = "2026-09-28";

  it("es la mediana de lo depositado por mes (varios depósitos del mismo mes se suman)", () => {
    const txs = [
      deposit("2026-07-03T15:00:00Z", "600"),
      deposit("2026-07-20T15:00:00Z", "400"), // julio: 1.000
      deposit("2026-08-03T15:00:00Z", "3000"),
      deposit("2026-09-03T15:00:00Z", "900"),
    ];
    expectDec(typicalMonthlyDeposit(txs, TODAY)!, "1000");
  });

  it("con una cantidad par de meses promedia los dos del medio", () => {
    const txs = [
      deposit("2026-06-03T15:00:00Z", "500"),
      deposit("2026-07-03T15:00:00Z", "1000"),
      deposit("2026-08-03T15:00:00Z", "2000"),
      deposit("2026-09-03T15:00:00Z", "9000"),
    ];
    expectDec(typicalMonthlyDeposit(txs, TODAY)!, "1500");
  });

  it("mira los 12 meses que terminan en el de hoy: ni el mes de hace un año ni meses futuros", () => {
    const txs = [
      deposit("2025-09-15T15:00:00Z", "99999"), // hace 12 meses: afuera
      deposit("2025-10-01T15:00:00Z", "700"), // el primero de los 12
      deposit("2026-10-01T15:00:00Z", "99999"), // futuro: afuera
    ];
    expectDec(typicalMonthlyDeposit(txs, TODAY)!, "700");
  });

  it("el mes es el del día de mercado (Nueva York), no el de UTC", () => {
    // 01/09 02:00 UTC es el 31/08 en Nueva York: cuenta para agosto.
    const txs = [
      deposit("2026-07-10T15:00:00Z", "100"),
      deposit("2026-09-01T02:00:00Z", "300"),
      deposit("2026-08-10T15:00:00Z", "300"),
      deposit("2026-09-10T15:00:00Z", "5000"),
    ];
    // Nueva York: julio 100, agosto 600, setiembre 5.000 → mediana 600 (en UTC serían 100, 300,
    // 5.300 → 300).
    expectDec(typicalMonthlyDeposit(txs, TODAY)!, "600");
  });

  it("ignora retiros, dividendos y otros movimientos; sin depósitos es null", () => {
    const txs = [
      cashTx("WITHDRAWAL", "2026-09-03T15:00:00Z", "100"),
      cashTx("INTEREST", "2026-09-03T15:00:00Z", "5"),
      dividend("2026-09-03T15:00:00Z", "AAPL", "3"),
      buy("2026-09-04T15:00:00Z", "AAPL", "1", "100"),
    ];
    expect(typicalMonthlyDeposit(txs, TODAY)).toBeNull();
    expect(typicalMonthlyDeposit([], TODAY)).toBeNull();
  });
});

describe("simulateAddition", () => {
  it("un símbolo nuevo con plata nueva: el total crece en el monto y el efectivo no cambia", () => {
    const result = simulateAddition(portfolio(), "NVDA", d("1000"), groupOf);
    expectDec(result.before!.total, "4000");
    expectDec(result.after.total, "5000");
    expect(result.before!.weights.has("NVDA")).toBe(false);
    expectDec(result.after.weights.get("NVDA")!, "0.2");
    expectDec(result.after.weights.get("AAPL")!, "0.2");
    expectDec(result.after.weights.get("VOO")!, "0.4");
    expect(result.before!.positions).toBe(2);
    expect(result.after.positions).toBe(3);
  });

  it("el grupo del candidato: Tecnología pasa de 25 % (AAPL) a 40 % (AAPL + NVDA)", () => {
    const result = simulateAddition(portfolio(), "NVDA", d("1000"), groupOf);
    expect(result.group).toBe("Technology");
    expectDec(result.before!.groupWeight!, "0.25");
    expectDec(result.after.groupWeight!, "0.4");
  });

  it("las 3 más grandes: antes solo hay 2 (75 %), después 40 + 20 + 20", () => {
    const result = simulateAddition(portfolio(), "NVDA", d("1000"), groupOf);
    expectDec(result.before!.top3, "0.75");
    expectDec(result.after.top3, "0.8");
  });

  it("sumar a una posición que ya existe", () => {
    const result = simulateAddition(portfolio(), "AAPL", d("1000"), groupOf);
    expectDec(result.before!.weights.get("AAPL")!, "0.25");
    expectDec(result.after.weights.get("AAPL")!, "0.4");
    expect(result.after.positions).toBe(2);
  });

  it("sin grupo conocido, sin peso de grupo", () => {
    const result = simulateAddition(portfolio(), "ZZZ", d("1000"), groupOf);
    expect(result.group).toBeNull();
    expect(result.after.groupWeight).toBeNull();
  });

  it("el efectivo negativo cuenta como 0 (falta cargar un depósito)", () => {
    // Deposita 1.000 y compra 3.000: efectivo −2.000.
    const result = simulateAddition(
      portfolio({ cash: "1000" }),
      "NVDA",
      d("1000"),
      groupOf,
    );
    expectDec(result.before!.total, "3000");
    expectDec(result.after.total, "4000");
  });

  it("una posición sin precio no entra", () => {
    const result = simulateAddition(
      portfolio({ prices: { AAPL: "100" } }),
      "NVDA",
      d("1000"),
      groupOf,
    );
    expectDec(result.before!.total, "2000"); // AAPL 1.000 + efectivo 1.000
    expect(result.before!.weights.has("VOO")).toBe(false);
  });

  it("sin cartera todavía: no hay antes y el candidato es todo", () => {
    const empty = valuePortfolio(computeEngine([]), new Map());
    const result = simulateAddition(empty, "NVDA", d("500"), groupOf);
    expect(result.before).toBeNull();
    expectDec(result.after.weights.get("NVDA")!, "1");
  });

  it("el monto tiene que ser positivo", () => {
    expect(() =>
      simulateAddition(portfolio(), "NVDA", d("0"), groupOf),
    ).toThrow(RangeError);
  });

  it("propiedad: después de la compra, pesos + efectivo = 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (amount) => {
        const result = simulateAddition(
          portfolio(),
          "NVDA",
          d(String(amount)),
          groupOf,
        );
        const cash = d("1000").div(result.after.total);
        const sum = [...result.after.weights.values()].reduce(
          (acc, w) => acc.plus(w),
          cash,
        );
        expect(sum.minus(1).abs().lt("1e-30")).toBe(true);
      }),
    );
  });
});

describe("alignReturns", () => {
  it("solo días hábiles: dos criptos con fin de semana miran las mismas ruedas que una acción", () => {
    // Del viernes 25 al martes 29 de setiembre de 2026, todos los días (como la cripto).
    const everyDay = (values: readonly string[]) =>
      closes(
        values.map((value, i): [string, string] => [
          `2026-09-${String(25 + i).padStart(2, "0")}`,
          value,
        ]),
      );
    const aligned = alignReturns(
      new Map([
        ["BTC-USD", everyDay(["100", "110", "121", "100", "105"])],
        ["ETH-USD", everyDay(["10", "10", "10", "12", "12"])],
      ]),
      "2026-09-25",
      "2026-09-29",
    );
    // Viernes → lunes (el fin de semana entra en el lunes) → martes.
    expect(aligned.dates).toEqual(["2026-09-28", "2026-09-29"]);
    expect(aligned.bySymbol.get("BTC-USD")).toEqual([0, 0.05]);
    expect(aligned.bySymbol.get("ETH-USD")).toEqual([
      expect.closeTo(0.2, 12),
      0,
    ]);
  });

  it("usa solo los días que tienen todos; si a uno le falta un día, el retorno abarca los dos", () => {
    const aligned = alignReturns(
      new Map([
        [
          "A",
          closes([
            ["2026-01-05", "100"],
            ["2026-01-06", "110"],
            ["2026-01-07", "121"],
          ]),
        ],
        [
          "B",
          closes([
            ["2026-01-05", "50"],
            ["2026-01-07", "60"], // sin el 06
          ]),
        ],
      ]),
      "2026-01-01",
      "2026-01-31",
    );
    expect(aligned.dates).toEqual(["2026-01-07"]);
    expect(aligned.bySymbol.get("A")![0]).toBeCloseTo(0.21, 12);
    expect(aligned.bySymbol.get("B")![0]).toBeCloseTo(0.2, 12);
    expect(aligned.limitedBy).toBeNull();
  });

  it("respeta la ventana, descarta cierres no positivos y lista lo que no tiene historia", () => {
    const aligned = alignReturns(
      new Map([
        [
          "A",
          closes([
            ["2025-12-31", "1"], // antes de la ventana
            ["2026-01-05", "100"],
            ["2026-01-06", "0"], // roto
            ["2026-01-07", "90"],
            ["2026-02-02", "1"], // después
          ]),
        ],
        ["Z", closes([["2025-06-01", "10"]])],
      ]),
      "2026-01-01",
      "2026-01-31",
    );
    expect(aligned.dates).toEqual(["2026-01-07"]);
    expect(aligned.bySymbol.get("A")![0]).toBeCloseTo(-0.1, 12);
    expect(aligned.missing).toEqual(["Z"]);
    expect(aligned.bySymbol.has("Z")).toBe(false);
  });

  const late = new Map([
    ["A", weekdaySeries("2026-01-02", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
    ["B", weekdaySeries("2026-01-08", [1, 2, 3, 4, 5, 6, 7, 8])], // 6 días tarde: tolerado
    ["C", weekdaySeries("2026-01-12", [1, 2, 3, 4, 5, 6])],
  ]);

  it("una posición con historia que arranca tarde queda afuera y no recorta la ventana de las demás", () => {
    const aligned = alignReturns(late, "2026-01-01", "2026-01-31", "A");
    expect(aligned.shortHistory).toEqual([
      { symbol: "C", since: "2026-01-12" },
    ]);
    expect(aligned.bySymbol.has("C")).toBe(false);
    expect(aligned.limitedBy).toBeNull();
    // A y B: desde el 08 (B, tolerado) hasta el 19 → 7 días en común, 6 retornos.
    expect(aligned.dates[0]).toBe("2026-01-09");
    expect(aligned.dates).toHaveLength(7);
  });

  it("el candidato (anchor) con historia corta sí recorta la ventana, y lo dice", () => {
    const aligned = alignReturns(late, "2026-01-01", "2026-01-31", "C");
    expect(aligned.limitedBy).toEqual({ symbol: "C", since: "2026-01-12" });
    expect(aligned.shortHistory).toEqual([]);
    expect(aligned.dates[0]).toBe("2026-01-13");
  });
});

describe("correlation", () => {
  const a = noise(1, 100);

  it("una serie consigo misma es 1 y con su opuesta es −1", () => {
    expect(correlation(a, a)).toBeCloseTo(1, 12);
    expect(
      correlation(
        a,
        a.map((x) => -2 * x),
      ),
    ).toBeCloseTo(-1, 12);
  });

  it("no depende de la escala ni de un desplazamiento", () => {
    const b = noise(2, 100);
    expect(
      correlation(
        a,
        b.map((x) => 3 * x + 0.01),
      ),
    ).toBeCloseTo(correlation(a, b)!, 12);
  });

  it("null si una serie no varía o si hay menos de MIN_SHARED_DAYS pares", () => {
    expect(
      correlation(
        a,
        a.map(() => 0.01),
      ),
    ).toBeNull();
    const short = a.slice(0, MIN_SHARED_DAYS - 1);
    expect(correlation(short, short)).toBeNull();
    expect(correlation(a.slice(0, MIN_SHARED_DAYS), a)).toBeCloseTo(1, 12);
  });

  it("propiedad: siempre entre −1 y 1", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -0.5, max: 0.5, noNaN: true }), {
          minLength: MIN_SHARED_DAYS,
          maxLength: 120,
        }),
        fc.integer({ min: 1, max: 1000 }),
        (xs, seed) => {
          const value = correlation(xs, noise(seed, xs.length));
          if (value !== null) {
            expect(value).toBeGreaterThanOrEqual(-1);
            expect(value).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});

describe("analyzeFit", () => {
  const START = "2026-01-02";
  const n = 120;
  const rA = noise(11, n);
  const rB = noise(22, n);
  const series = new Map([
    ["A", fromReturns(START, rA)],
    ["B", fromReturns(START, rB)],
    [
      "C",
      fromReturns(
        START,
        rA.map((x, i) => 0.9 * x + 0.1 * (rB[i] as number)),
      ),
    ], // casi A
  ]);
  const aligned = alignReturns(series, START, "2026-12-31");
  const w = (entries: Record<string, string>) =>
    new Map(
      Object.entries(entries).map(([s, v]) => [s, d(v)] as [string, Dec]),
    );

  it("la posición que más se parece al candidato", () => {
    const fit = analyzeFit(
      aligned,
      "C",
      w({ A: "0.5", B: "0.5" }),
      w({ A: "0.4", B: "0.4", C: "0.2" }),
    );
    expect(fit.days).toBe(n);
    expect(fit.closest?.symbol).toBe("A");
    expect(fit.closest!.correlation).toBeCloseTo(
      correlation(aligned.bySymbol.get("C")!, aligned.bySymbol.get("A")!)!,
      12,
    );
  });

  it("la correlación es contra el resto de la cartera (sin el candidato)", () => {
    // El candidato es A y ya está en la cartera: se compara contra B sola.
    const fit = analyzeFit(
      aligned,
      "A",
      w({ A: "0.5", B: "0.5" }),
      w({ A: "0.6", B: "0.4" }),
    );
    expect(fit.correlation).toBeCloseTo(
      correlation(aligned.bySymbol.get("A")!, aligned.bySymbol.get("B")!)!,
      12,
    );
    expect(fit.closest?.symbol).toBe("B");
  });

  it("la volatilidad es la de la cartera con pesos fijos (el efectivo rinde 0)", () => {
    // Mitad A, mitad efectivo: la volatilidad es la mitad de la de A.
    const fit = analyzeFit(
      aligned,
      "B",
      w({ A: "0.5" }),
      w({ A: "0.5", B: "0.25" }),
    );
    const volA = annualizedVolatilityOf(aligned.bySymbol.get("A")!)!;
    expect(fit.volatilityBefore).toBeCloseTo(volA / 2, 12);
    const expected = annualizedVolatilityOf(
      aligned.dates.map(
        (_, k) =>
          0.5 * aligned.bySymbol.get("A")![k]! +
          0.25 * aligned.bySymbol.get("B")![k]!,
      ),
    );
    expect(fit.volatilityAfter).toBeCloseTo(expected!, 12);
  });

  it("sin cartera todavía: sin correlación ni volatilidad de antes, pero sí la de después", () => {
    const fit = analyzeFit(aligned, "A", null, w({ A: "1" }));
    expect(fit.correlation).toBeNull();
    expect(fit.closest).toBeNull();
    expect(fit.volatilityBefore).toBeNull();
    expect(fit.volatilityAfter).toBeCloseTo(
      annualizedVolatilityOf(aligned.bySymbol.get("A")!)!,
      12,
    );
  });

  it("con menos de MIN_SHARED_DAYS retornos en común no dice nada", () => {
    const short = alignReturns(
      new Map([
        ["A", fromReturns(START, rA.slice(0, MIN_SHARED_DAYS - 1))],
        ["B", fromReturns(START, rB.slice(0, MIN_SHARED_DAYS - 1))],
      ]),
      START,
      "2026-12-31",
    );
    const fit = analyzeFit(
      short,
      "A",
      w({ B: "1" }),
      w({ A: "0.5", B: "0.5" }),
    );
    expect(fit).toEqual({
      days: MIN_SHARED_DAYS - 1,
      correlation: null,
      closest: null,
      volatilityBefore: null,
      volatilityAfter: null,
    });
  });

  it("un candidato sin historia: sin parecido, pero la volatilidad de la cartera sí", () => {
    const fit = analyzeFit(
      aligned,
      "ZZZ",
      w({ A: "1" }),
      w({ A: "0.5", ZZZ: "0.5" }),
    );
    expect(fit.correlation).toBeNull();
    expect(fit.closest).toBeNull();
    expect(fit.volatilityBefore).not.toBeNull();
  });
});

describe("volatilityModel", () => {
  const START = "2026-01-02";
  const n = 120;
  const rA = noise(31, n);
  const rB = noise(42, n);
  const aligned = alignReturns(
    new Map([
      ["A", fromReturns(START, rA)],
      ["B", fromReturns(START, rB)],
      [
        "C",
        fromReturns(
          START,
          rA.map((x, i) => 0.5 * x - 0.5 * (rB[i] as number)),
        ),
      ],
    ]),
    START,
    "2026-12-31",
  );
  const w = (entries: Record<string, number>) =>
    new Map(
      Object.entries(entries).map(
        ([s, v]) => [s, d(v.toFixed(12))] as [string, Dec],
      ),
    );
  /** La volatilidad de después según el modelo, comprando `x` veces el total de hoy. */
  const after = (model: VolatilityModel, x: number) =>
    Math.sqrt(
      model.portfolio + 2 * x * model.covariance + x * x * model.candidate,
    ) /
    (1 + x);

  it("da la misma volatilidad que analyzeFit para cualquier monto (candidato nuevo)", () => {
    // Hoy: 30 % A, 20 % B y el resto efectivo. Se compra C por x veces el total.
    const before = { A: 0.3, B: 0.2 };
    const model = volatilityModel(aligned, "C", w(before))!;
    for (const x of [0.001, 0.05, 0.5, 1, 3, 250]) {
      const fit = analyzeFit(
        aligned,
        "C",
        w(before),
        w({ A: 0.3 / (1 + x), B: 0.2 / (1 + x), C: x / (1 + x) }),
      );
      expect(Math.sqrt(model.portfolio)).toBeCloseTo(fit.volatilityBefore!, 9);
      expect(after(model, x)).toBeCloseTo(fit.volatilityAfter!, 9);
    }
  });

  it("sumar a una posición que ya existe también coincide", () => {
    const before = { A: 0.3, B: 0.2 };
    const model = volatilityModel(aligned, "A", w(before))!;
    for (const x of [0.01, 0.4, 2]) {
      const fit = analyzeFit(
        aligned,
        "A",
        w(before),
        w({ A: (0.3 + x) / (1 + x), B: 0.2 / (1 + x) }),
      );
      expect(after(model, x)).toBeCloseTo(fit.volatilityAfter!, 9);
    }
  });

  it("un candidato sin historia solo diluye: la volatilidad baja con el monto", () => {
    const model = volatilityModel(aligned, "ZZZ", w({ A: 1 }))!;
    expect(model.covariance).toBe(0);
    expect(model.candidate).toBe(0);
    const fit = analyzeFit(
      aligned,
      "ZZZ",
      w({ A: 1 }),
      w({ A: 0.5, ZZZ: 0.5 }),
    );
    expect(after(model, 1)).toBeCloseTo(fit.volatilityAfter!, 9);
    expect(after(model, 1)).toBeCloseTo(Math.sqrt(model.portfolio) / 2, 12);
  });

  it("sin cartera, sin retornos en común suficientes o sin posiciones medibles: null", () => {
    expect(volatilityModel(aligned, "C", null)).toBeNull();
    expect(volatilityModel(aligned, "C", w({ ZZZ: 1 }))).toBeNull();
    const short = alignReturns(
      new Map([
        ["A", fromReturns(START, rA.slice(0, MIN_SHARED_DAYS - 1))],
        ["C", fromReturns(START, rB.slice(0, MIN_SHARED_DAYS - 1))],
      ]),
      START,
      "2026-12-31",
    );
    expect(volatilityModel(short, "C", w({ A: 1 }))).toBeNull();
  });
});

describe("simulateMonthlyPlan", () => {
  const prices = closes([
    ["2026-01-02", "100"],
    ["2026-01-15", "50"],
    ["2026-02-02", "50"],
    ["2026-02-20", "100"],
    ["2026-03-02", "100"],
  ]);

  it("aporta el primer cierre de cada mes y valúa cada día", () => {
    const plan = simulateMonthlyPlan(
      prices,
      d("100"),
      "2026-01-01",
      "2026-12-31",
    )!;
    expect(plan.contributions).toBe(3);
    expect(plan.start).toBe("2026-01-02");
    expect(plan.end).toBe("2026-03-02");
    // 1 + 2 + 1 unidades = 4 × 100
    expectDec(plan.invested, "300");
    expectDec(plan.value, "400");
    expect(
      plan.points.map((p) => [p.date, p.invested.toFixed(), p.value.toFixed()]),
    ).toEqual([
      ["2026-01-02", "100", "100"],
      ["2026-01-15", "100", "50"],
      ["2026-02-02", "200", "150"],
      ["2026-02-20", "200", "300"],
      ["2026-03-02", "300", "400"],
    ]);
  });

  it("el peor momento es el de más pérdida sobre lo aportado, con su recuperación", () => {
    const plan = simulateMonthlyPlan(
      prices,
      d("100"),
      "2026-01-01",
      "2026-12-31",
    )!;
    expect(plan.worst).toEqual({
      date: "2026-01-15",
      depth: d("-0.5"),
      recoveredDate: "2026-02-20",
    });
  });

  it("volver justo a lo aportado ya cuenta como recuperado", () => {
    const exact = closes([
      ["2026-01-02", "100"],
      ["2026-01-15", "50"],
      ["2026-01-20", "100"],
    ]);
    expect(
      simulateMonthlyPlan(exact, d("100"), "2026-01-01", "2026-12-31")!.worst
        ?.recoveredDate,
    ).toBe("2026-01-20");
  });

  it("todavía sin recuperar", () => {
    const plan = simulateMonthlyPlan(
      prices,
      d("100"),
      "2026-01-01",
      "2026-02-02",
    )!;
    expect(plan.worst?.recoveredDate).toBeNull();
  });

  it("nunca por debajo de lo aportado: sin peor momento", () => {
    const up = closes([
      ["2026-01-02", "10"],
      ["2026-02-02", "11"],
      ["2026-03-02", "12"],
    ]);
    expect(
      simulateMonthlyPlan(up, d("100"), "2026-01-01", "2026-12-31")!.worst,
    ).toBeNull();
  });

  it("el redondeo de monto / precio no inventa una pérdida (100 / 3 × 3 = 99,99…)", () => {
    const flat = closes([
      ["2026-01-02", "3"],
      ["2026-01-05", "3"],
      ["2026-02-02", "3"],
    ]);
    expect(
      simulateMonthlyPlan(flat, d("100"), "2026-01-01", "2026-12-31")!.worst,
    ).toBeNull();
  });

  it("empezando a mitad de mes, el primer aporte es el primer cierre desde `from`", () => {
    const plan = simulateMonthlyPlan(
      prices,
      d("100"),
      "2026-01-10",
      "2026-12-31",
    )!;
    expect(plan.start).toBe("2026-01-15");
    expect(plan.contributions).toBe(3);
    // 2 + 2 + 1 = 5 unidades × 100
    expectDec(plan.value, "500");
  });

  it("ordena los cierres y descarta los no positivos", () => {
    const messy = closes([
      ["2026-02-02", "50"],
      ["2026-01-02", "100"],
      ["2026-01-05", "0"],
    ]);
    const plan = simulateMonthlyPlan(
      messy,
      d("100"),
      "2026-01-01",
      "2026-12-31",
    )!;
    expect(plan.points.map((p) => p.date)).toEqual([
      "2026-01-02",
      "2026-02-02",
    ]);
  });

  it("sin cierres en el rango es null; el monto tiene que ser positivo", () => {
    expect(
      simulateMonthlyPlan(prices, d("100"), "2027-01-01", "2027-12-31"),
    ).toBeNull();
    expect(() =>
      simulateMonthlyPlan(prices, d("-1"), "2026-01-01", "2026-12-31"),
    ).toThrow(RangeError);
  });

  it("propiedad: lo aportado es aportes × monto y el valor escala con el monto", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100_000 }), {
          minLength: 2,
          maxLength: 80,
        }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 2, max: 50 }),
        (cents, amount, factor) => {
          const series = weekdaySeries(
            "2026-01-02",
            cents.map((c) => c / 100),
          ).map((c, i) => ({ date: addDays(c.date, i * 6), close: c.close })); // cruza meses
          const one = simulateMonthlyPlan(
            series,
            d(String(amount)),
            "2026-01-01",
            "2030-12-31",
          )!;
          const many = simulateMonthlyPlan(
            series,
            d(String(amount * factor)),
            "2026-01-01",
            "2030-12-31",
          )!;
          expect(
            one.invested.eq(d(String(amount)).mul(one.contributions)),
          ).toBe(true);
          expect(
            many.value.minus(one.value.mul(factor)).abs().lt("1e-20"),
          ).toBe(true);
          expect(many.worst?.date).toBe(one.worst?.date);
        },
      ),
    );
  });
});

describe("priceDrawdown", () => {
  it("la mayor caída de máximo a mínimo y cuándo volvió al máximo", () => {
    const stat = priceDrawdown(
      closes([
        ["2026-01-02", "100"],
        ["2026-01-05", "120"],
        ["2026-01-06", "90"],
        ["2026-01-07", "60"],
        ["2026-01-08", "110"],
        ["2026-01-09", "130"],
      ]),
      "2026-01-01",
      "2026-12-31",
    );
    expect(stat).toEqual({
      depth: d("-0.5"),
      peakDate: "2026-01-05",
      troughDate: "2026-01-07",
      recoveredDate: "2026-01-09",
    });
  });

  it("una caída posterior más chica no reemplaza a la mayor", () => {
    const stat = priceDrawdown(
      closes([
        ["2026-01-02", "100"],
        ["2026-01-05", "50"],
        ["2026-01-06", "200"],
        ["2026-01-07", "180"],
      ]),
      "2026-01-01",
      "2026-12-31",
    )!;
    expect(stat.troughDate).toBe("2026-01-05");
    expect(stat.recoveredDate).toBe("2026-01-06");
  });

  it("sin recuperar, y solo dentro del rango", () => {
    const series = closes([
      ["2025-12-30", "500"], // afuera: no es el máximo
      ["2026-01-02", "100"],
      ["2026-01-05", "80"],
    ]);
    expect(priceDrawdown(series, "2026-01-01", "2026-12-31")).toEqual({
      depth: d("-0.2"),
      peakDate: "2026-01-02",
      troughDate: "2026-01-05",
      recoveredDate: null,
    });
  });

  it("si el precio se queda en el máximo, la caída arranca en el último día ahí (como en Riesgo)", () => {
    const stat = priceDrawdown(
      closes([
        ["2026-01-02", "100"],
        ["2026-01-05", "100"],
        ["2026-01-06", "80"],
      ]),
      "2026-01-01",
      "2026-12-31",
    )!;
    expect(stat.peakDate).toBe("2026-01-05");
  });

  it("si nunca bajó, null", () => {
    expect(
      priceDrawdown(
        closes([
          ["2026-01-02", "100"],
          ["2026-01-05", "100"],
          ["2026-01-06", "101"],
        ]),
        "2026-01-01",
        "2026-12-31",
      ),
    ).toBeNull();
  });
});
