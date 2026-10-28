import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  combineContributions,
  contributionBetween,
  type ContributionResult,
} from "../attribution";
import { d, ZERO, type Dec } from "../decimal";
import { buildDailySeries } from "../series";
import type { Transaction } from "../types";
import type { DailyClose } from "../valuation";
import {
  buy,
  cashTx,
  deepFreeze,
  deposit,
  dividend,
  expectDec,
  sell,
  split,
  withdrawal,
} from "./helpers";

// Setiembre de 2026: lun 21, mar 22, mié 23, jue 24, vie 25, sáb 26, dom 27, lun 28.
// Las 15:00Z son las 11:00 en Nueva York: cada operación cae en su día.
const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T15:00:00Z`;
const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}`;

function closesOf(
  spec: Record<string, ReadonlyArray<readonly [number, string]>>,
): Map<string, DailyClose[]> {
  return new Map(
    Object.entries(spec).map(([symbol, rows]) => [
      symbol,
      rows.map(([n, close]) => ({ date: day(n), close: d(close) })),
    ]),
  );
}

const rowOf = (result: ContributionResult, symbol: string) => {
  const row = result.symbols.find((r) => r.symbol === symbol);
  if (!row) throw new Error(`Sin fila para ${symbol}`);
  return row;
};

/** Σ contribuciones + otros = cambio de valor − flujos externos. */
function expectConservation(result: ContributionResult): void {
  const contributions = result.symbols.reduce(
    (acc, r) => acc.plus(r.contribution),
    ZERO,
  );
  expectDec(
    contributions.plus(result.other),
    result.endValue
      .minus(result.startValue)
      .minus(result.externalFlows)
      .toFixed(),
  );
}

describe("contributionBetween", () => {
  it("una posición que solo cambió de precio contribuye la diferencia de valor", () => {
    const result = contributionBetween({
      transactions: [deposit(at(21), "1000"), buy(at(21), "VOO", "10", "100")],
      closes: closesOf({
        VOO: [
          [21, "100"],
          [25, "110"],
        ],
      }),
      from: day(21),
      to: day(25),
    });
    expectDec(result.startValue, "1000");
    expectDec(result.endValue, "1100");
    expectDec(rowOf(result, "VOO").contribution, "100");
    expectDec(result.externalFlows, "0");
    expectConservation(result);
  });

  it("una compra dentro del rango no cuenta como ganancia", () => {
    const result = contributionBetween({
      transactions: [
        deposit(at(21), "1000"),
        buy(at(21), "VOO", "10", "100"),
        deposit(at(23), "525"),
        buy(at(23), "VOO", "5", "105"),
      ],
      closes: closesOf({
        VOO: [
          [21, "100"],
          [23, "105"],
          [25, "110"],
        ],
      }),
      from: day(21),
      to: day(25),
    });
    const voo = rowOf(result, "VOO");
    expectDec(voo.startValue, "1000");
    expectDec(voo.endValue, "1650");
    expectDec(voo.cashFlow, "-525");
    // 10 × 10 + 5 × 5
    expectDec(voo.contribution, "125");
    expectDec(result.externalFlows, "525");
    expectConservation(result);
  });

  it("ventas, dividendos y comisiones del símbolo entran en su contribución", () => {
    const result = contributionBetween({
      transactions: [
        deposit(at(21), "2000"),
        buy(at(21), "AAPL", "10", "100"),
        sell(at(23), "AAPL", "10", "120", "1"), // 1199
        buy(at(21), "KO", "10", "50"),
        dividend(at(24), "KO", "5"),
        cashTx("TAX", at(24), "1", "KO"),
      ],
      closes: closesOf({
        AAPL: [
          [21, "100"],
          [23, "120"],
        ],
        KO: [
          [21, "50"],
          [25, "49"],
        ],
      }),
      from: day(21),
      to: day(25),
    });
    const aapl = rowOf(result, "AAPL");
    expectDec(aapl.endValue, "0");
    expectDec(aapl.contribution, "199");
    // −10 de precio + 5 de dividendo − 1 de retención
    expectDec(rowOf(result, "KO").contribution, "-6");
    expect(result.symbols.map((r) => r.symbol)).toEqual(["AAPL", "KO"]);
    expectConservation(result);
  });

  it("des-ajusta los cierres con los splits que todavía no ocurrieron", () => {
    // Cierres guardados ajustados por el split 2:1 del 23: el 21 la acción valía 100 (50 × 2).
    const result = contributionBetween({
      transactions: [
        deposit(at(21), "1000"),
        buy(at(21), "NVDA", "10", "100"),
        split(at(23), "NVDA", "2"),
      ],
      closes: closesOf({
        NVDA: [
          [21, "50"],
          [25, "55"],
        ],
      }),
      from: day(21),
      to: day(25),
    });
    expectDec(rowOf(result, "NVDA").startValue, "1000");
    expectDec(rowOf(result, "NVDA").endValue, "1100");
    expectDec(rowOf(result, "NVDA").contribution, "100");
  });

  it("sin ningún cierre valúa a costo y lo informa", () => {
    const result = contributionBetween({
      transactions: [deposit(at(21), "1000"), buy(at(21), "NEW", "10", "100")],
      closes: new Map(),
      from: day(21),
      to: day(25),
    });
    expectDec(rowOf(result, "NEW").contribution, "0");
    expect(result.unpriced).toEqual(["NEW"]);
  });

  it("intereses, comisiones e impuestos sueltos van a «otros»", () => {
    const result = contributionBetween({
      transactions: [
        deposit(at(21), "1000"),
        cashTx("INTEREST", at(22), "3"),
        cashTx("FEE", at(23), "2"),
        withdrawal(at(24), "100"),
      ],
      closes: new Map(),
      from: day(21),
      to: day(25),
    });
    expectDec(result.other, "1");
    expectDec(result.externalFlows, "-100");
    expect(result.symbols).toEqual([]);
    expectConservation(result);
  });

  it("lo que pasa el día de partida queda fuera y el del final, dentro", () => {
    const result = contributionBetween({
      transactions: [
        deposit(at(21), "1000"),
        buy(at(22), "VOO", "1", "100"),
        buy(at(25), "VOO", "1", "100"),
        buy(at(28), "VOO", "1", "100"),
      ],
      closes: closesOf({
        VOO: [
          [21, "100"],
          [25, "100"],
          [28, "100"],
        ],
      }),
      from: day(22),
      to: day(25),
    });
    expectDec(rowOf(result, "VOO").startValue, "100");
    expectDec(rowOf(result, "VOO").endValue, "200");
    expectDec(rowOf(result, "VOO").cashFlow, "-100");
  });

  it("un rango de un solo día no mueve nada", () => {
    const result = contributionBetween({
      transactions: [deposit(at(21), "1000"), buy(at(21), "VOO", "10", "100")],
      closes: closesOf({ VOO: [[21, "100"]] }),
      from: day(21),
      to: day(21),
    });
    expectDec(rowOf(result, "VOO").contribution, "0");
    expectDec(result.startValue, result.endValue.toFixed());
  });

  it("rechaza un rango al revés y no muta la entrada", () => {
    const transactions = deepFreeze([deposit(at(21), "1000")]);
    expect(() =>
      contributionBetween({
        transactions,
        closes: new Map(),
        from: day(25),
        to: day(21),
      }),
    ).toThrow();
  });

  it("una venta que excede la tenencia no mueve nada", () => {
    const result = contributionBetween({
      transactions: [
        deposit(at(21), "1000"),
        buy(at(21), "VOO", "1", "100"),
        sell(at(23), "VOO", "5", "100"),
      ],
      closes: closesOf({
        VOO: [
          [21, "100"],
          [25, "100"],
        ],
      }),
      from: day(21),
      to: day(25),
    });
    expectDec(rowOf(result, "VOO").cashFlow, "0");
    expectDec(rowOf(result, "VOO").endValue, "100");
  });

  it("los valores de partida y final coinciden con la serie diaria", () => {
    const transactions = [
      deposit(at(21), "3000"),
      buy(at(21), "VOO", "10", "100"),
      buy(at(22), "NVDA", "5", "200", "1"),
      split(at(24), "NVDA", "2"),
      sell(at(25), "VOO", "4", "112"),
      dividend(at(28), "VOO", "3"),
    ];
    const closes = closesOf({
      VOO: [
        [21, "100"],
        [22, "103"],
        [23, "101"],
        [24, "108"],
        [25, "112"],
        [28, "115"],
      ],
      NVDA: [
        [21, "95"],
        [22, "100"],
        [23, "104"],
        [24, "110"],
        [25, "107"],
        [28, "111"],
      ],
    });
    const series = buildDailySeries({ transactions, closes, endDate: day(28) });
    const valueOn = (date: string) =>
      series.points.find((p) => p.date === date)!.value.toFixed();

    for (const [from, to] of [
      [21, 28],
      [22, 24],
      [23, 25],
    ] as const) {
      const result = contributionBetween({
        transactions,
        closes,
        from: day(from),
        to: day(to),
      });
      expectDec(result.startValue, valueOn(day(from)));
      expectDec(result.endValue, valueOn(day(to)));
      expectConservation(result);
    }
  });
});

describe("contributionBetween: conservación con historiales aleatorios", () => {
  const SYMBOLS = ["AAA", "BBB"] as const;
  const DAYS = [21, 22, 23, 24, 25, 28, 29, 30] as const;

  type Step =
    | { kind: "deposit" | "withdrawal" | "fee"; day: number; cents: number }
    | {
        kind: "buy" | "sell";
        day: number;
        symbol: number;
        units: number;
        cents: number;
      }
    | { kind: "dividend"; day: number; symbol: number; cents: number };

  const dayIndex = fc.integer({ min: 0, max: DAYS.length - 1 });
  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.record({
      kind: fc.constantFrom(
        "deposit" as const,
        "withdrawal" as const,
        "fee" as const,
      ),
      day: dayIndex,
      cents: fc.integer({ min: 1, max: 500_000 }),
    }),
    fc.record({
      kind: fc.constantFrom("buy" as const, "sell" as const),
      day: dayIndex,
      symbol: fc.integer({ min: 0, max: 1 }),
      units: fc.integer({ min: 1, max: 50 }),
      cents: fc.integer({ min: 1, max: 50_000 }),
    }),
    fc.record({
      kind: fc.constant("dividend" as const),
      day: dayIndex,
      symbol: fc.integer({ min: 0, max: 1 }),
      cents: fc.integer({ min: 1, max: 10_000 }),
    }),
  );

  const toTx = (s: Step): Transaction => {
    const when = at(DAYS[s.day] as number);
    const money = (cents: number) => (cents / 100).toFixed(2);
    switch (s.kind) {
      case "deposit":
        return deposit(when, money(s.cents));
      case "withdrawal":
        return withdrawal(when, money(s.cents));
      case "fee":
        return cashTx("FEE", when, money(s.cents));
      case "buy":
        return buy(when, SYMBOLS[s.symbol]!, String(s.units), money(s.cents));
      case "sell":
        return sell(when, SYMBOLS[s.symbol]!, String(s.units), money(s.cents));
      case "dividend":
        return dividend(when, SYMBOLS[s.symbol]!, money(s.cents));
    }
  };

  const closePrices = fc.array(fc.integer({ min: 1, max: 50_000 }), {
    minLength: DAYS.length,
    maxLength: DAYS.length,
  });

  it("Σ contribuciones + otros = cambio de valor − flujos, y coincide con la serie", () => {
    fc.assert(
      fc.property(
        fc.array(step, { minLength: 1, maxLength: 25 }),
        closePrices,
        closePrices,
        fc.integer({ min: 0, max: DAYS.length - 1 }),
        fc.integer({ min: 0, max: DAYS.length - 1 }),
        (steps, pricesA, pricesB, i, j) => {
          const transactions = steps.map(toTx);
          const closes = new Map(
            SYMBOLS.map((symbol, k) => [
              symbol,
              DAYS.map((n, m) => ({
                date: day(n),
                close: d(((k === 0 ? pricesA : pricesB)[m]! / 100).toFixed(2)),
              })),
            ]),
          );
          const [from, to] = [
            day(DAYS[Math.min(i, j)]!),
            day(DAYS[Math.max(i, j)]!),
          ];
          const result = contributionBetween({
            transactions,
            closes,
            from,
            to,
          });
          expectConservation(result);

          const series = buildDailySeries({
            transactions,
            closes,
            endDate: day(30),
          });
          const valueOn = (date: string): Dec | null =>
            series.points.find((p) => p.date === date)?.value ?? null;
          const start = valueOn(from);
          if (start !== null) expectDec(result.startValue, start.toFixed());
          const end = valueOn(to);
          if (end !== null) expectDec(result.endValue, end.toFixed());
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("combineContributions", () => {
  const range = { from: day(21), to: day(25) };
  const closes = closesOf({
    VOO: [
      [21, "100"],
      [25, "110"],
    ],
    KO: [
      [21, "50"],
      [25, "60"],
    ],
  });
  const accountA = contributionBetween({
    ...range,
    closes,
    transactions: [deposit(at(21), "1000"), buy(at(21), "VOO", "10", "100")],
  });
  const accountB = contributionBetween({
    ...range,
    closes,
    transactions: [
      { ...deposit(at(21), "1000"), accountId: "acc-2" },
      { ...buy(at(21), "VOO", "1", "100"), accountId: "acc-2" },
      { ...buy(at(21), "KO", "2", "50"), accountId: "acc-2" },
    ],
  });

  it("suma por símbolo y conserva el total", () => {
    const combined = combineContributions([accountA, accountB])!;
    expectDec(rowOf(combined, "VOO").contribution, "110");
    expectDec(rowOf(combined, "KO").contribution, "20");
    expectDec(combined.startValue, "2000");
    expectConservation(combined);
  });

  it("con una sola cuenta devuelve lo mismo, y sin ninguna, null", () => {
    expect(combineContributions([accountA])).toEqual(accountA);
    expect(combineContributions([])).toBeNull();
  });

  it("rechaza rangos distintos", () => {
    expect(() =>
      combineContributions([accountA, { ...accountB, to: day(28) }]),
    ).toThrow();
  });
});
