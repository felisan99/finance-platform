import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { d, ZERO, type Dec } from "../decimal";
import {
  annualizeTwr,
  computeTwr,
  computeXirr,
  type DatedFlow,
} from "../returns";
import type { SeriesPoint } from "../series";

const point = (date: string, growth: string | null): SeriesPoint => ({
  date,
  value: ZERO,
  cash: ZERO,
  marketValue: ZERO,
  flow: ZERO,
  growth: growth === null ? null : d(growth),
  unpriced: [],
});

const flow = (date: string, amount: string): DatedFlow => ({
  date,
  amount: d(amount),
});

const START = "2024-01-01";
const later = (days: number) => addDays(START, days);
const num = (value: Dec | null): number => (value as Dec).toNumber();

describe("computeTwr", () => {
  const points = [
    point("2026-09-21", "1.1"),
    point("2026-09-22", "0.9"),
    point("2026-09-23", "1.2"),
    point("2026-09-24", "1.5"),
  ];

  it("encadena los crecimientos diarios: Π (1 + r_t) − 1", () => {
    // 1,1 × 0,9 × 1,2 × 1,5 = 1,782
    const { twr, days } = computeTwr(points, "2026-09-18", "2026-09-24");
    expect(twr!.toFixed()).toBe("0.782");
    expect(days).toBe(4);
  });

  it("el día base no entra (su retorno es del período anterior) y el final sí", () => {
    // Desde el cierre del 21: 0,9 × 1,2 × 1,5 = 1,62.
    expect(computeTwr(points, "2026-09-21", "2026-09-24").twr!.toFixed()).toBe(
      "0.62",
    );
    // Hasta el 22 inclusive: 1,1 × 0,9 = 0,99.
    expect(computeTwr(points, "2026-09-18", "2026-09-22").twr!.toFixed()).toBe(
      "-0.01",
    );
  });

  it("los días sin base (growth null) no aportan retorno", () => {
    const withGap = [point("2026-09-21", null), ...points.slice(1)];
    const { twr, days } = computeTwr(withGap, "2026-09-18", "2026-09-24");
    // 0,9 × 1,2 × 1,5 = 1,62; el primero no cuenta.
    expect(twr!.toFixed()).toBe("0.62");
    expect(days).toBe(3);
  });

  it("sin ningún día válido no hay TWR (no es 0 %)", () => {
    expect(computeTwr(points, "2026-09-24", "2026-09-30")).toEqual({
      twr: null,
      days: 0,
    });
    expect(
      computeTwr([point("2026-09-21", null)], "2026-09-18", "2026-09-24"),
    ).toEqual({ twr: null, days: 0 });
    expect(computeTwr([], "2026-09-18", "2026-09-24").twr).toBeNull();
  });

  it("una pérdida total es −100 %", () => {
    expect(
      computeTwr(
        [point("2026-09-21", "0")],
        "2026-09-18",
        "2026-09-21",
      ).twr!.toFixed(),
    ).toBe("-1");
  });
});

describe("annualizeTwr", () => {
  it("solo si el período dura más de un año (spec §6.5)", () => {
    expect(annualizeTwr(d("0.21"), 365)).toBeNull();
    expect(annualizeTwr(d("0.21"), 30)).toBeNull();
    expect(annualizeTwr(d("0.21"), 366)).not.toBeNull();
  });

  it("21 % en dos años (730 días) son 10 % anual: 1,21^(365/730) = 1,1", () => {
    expect(num(annualizeTwr(d("0.21"), 730))).toBeCloseTo(0.1, 12);
  });

  it("en 368 días: 1,21^(365/368) − 1", () => {
    expect(num(annualizeTwr(d("0.21"), 368))).toBeCloseTo(
      Math.pow(1.21, 365 / 368) - 1,
      12,
    );
  });

  it("sin TWR no hay anualizado; una pérdida total sigue siendo −100 %", () => {
    expect(annualizeTwr(null, 1000)).toBeNull();
    expect(annualizeTwr(d("-1"), 1000)!.toFixed()).toBe("-1");
  });
});

describe("computeXirr: soluciones cerradas", () => {
  it("−100 y +121 con 730 días de por medio: 1,21^(365/730) − 1 = 10 %", () => {
    const xirr = computeXirr([flow(START, "-100"), flow(later(730), "121")]);
    expect(num(xirr)).toBeCloseTo(0.1, 10);
  });

  it("−100, −100 (a 365 días) y +231 (a 730): x² + x − 2,31 = 0 → x = 1,1 → 10 %", () => {
    const xirr = computeXirr([
      flow(START, "-100"),
      flow(later(365), "-100"),
      flow(later(730), "231"),
    ]);
    expect(num(xirr)).toBeCloseTo(0.1, 10);
  });

  it("no importa el orden en que vengan los flujos", () => {
    const xirr = computeXirr([
      flow(later(730), "231"),
      flow(later(365), "-100"),
      flow(START, "-100"),
    ]);
    expect(num(xirr)).toBeCloseTo(0.1, 10);
  });

  it("una pérdida: −100 y +81 a 730 días → 0,81^(1/2) − 1 = −10 %", () => {
    expect(
      num(computeXirr([flow(START, "-100"), flow(later(730), "81")])),
    ).toBeCloseTo(-0.1, 10);
  });

  it("un año exacto: la tasa es el retorno simple", () => {
    expect(
      num(computeXirr([flow(START, "-1000"), flow(later(365), "1100")])),
    ).toBeCloseTo(0.1, 10);
  });

  it("con un cobro intermedio: −100, +50 (a 365) y +60,5 (a 730) → 100x² − 50x − 60,5 = 0", () => {
    // f(r) = −100 + 50/x + 60,5/x² = 0 con x = 1 + r  ⇒  100x² − 50x − 60,5 = 0
    // ⇒ x = (50 + √(50² + 4·100·60,5)) / 200 = (50 + √26700) / 200 ≈ 1,067 (r ≈ 6,7 %).
    const x = (50 + Math.sqrt(50 * 50 + 4 * 100 * 60.5)) / 200;
    const xirr = computeXirr([
      flow(START, "-100"),
      flow(later(365), "50"),
      flow(later(730), "60.5"),
    ]);
    expect(num(xirr)).toBeCloseTo(x - 1, 10);
  });
});

describe("computeXirr: rutas de cálculo", () => {
  it("una pérdida casi total (−99 %) no la resuelve Newton (se sale del dominio): decide la bisección", () => {
    // −100 y +1 a un año: r = 1/100 − 1 = −0,99. Newton desde 10 % salta a una tasa < −100 %.
    expect(
      num(computeXirr([flow(START, "-100"), flow(later(365), "1")])),
    ).toBeCloseTo(-0.99, 8);
  });

  it("una ganancia enorme en poco tiempo: 10x en 60 días", () => {
    const expected = Math.pow(10, 365 / 60) - 1;
    const xirr = num(
      computeXirr([flow(START, "-100"), flow(later(60), "1000")]),
    );
    expect(Math.abs(xirr - expected) / expected).toBeLessThan(1e-8);
  });
});

describe("computeXirr: sin solución", () => {
  it("necesita al menos una salida y una entrada", () => {
    expect(computeXirr([])).toBeNull();
    expect(computeXirr([flow(START, "-100")])).toBeNull();
    expect(
      computeXirr([flow(START, "-100"), flow(later(365), "-50")]),
    ).toBeNull();
    expect(
      computeXirr([flow(START, "100"), flow(later(365), "50")]),
    ).toBeNull();
  });

  it("los montos en cero se ignoran", () => {
    expect(
      computeXirr([flow(START, "-100"), flow(later(365), "0")]),
    ).toBeNull();
    expect(
      num(
        computeXirr([
          flow(START, "-100"),
          flow(later(100), "0"),
          flow(later(365), "110"),
        ]),
      ),
    ).toBeCloseTo(0.1, 10);
  });

  it("todo el mismo día no define una tasa anual", () => {
    expect(computeXirr([flow(START, "-100"), flow(START, "110")])).toBeNull();
  });

  it("una pérdida total (solo entradas de valor cero) no tiene tasa", () => {
    expect(
      computeXirr([flow(START, "-100"), flow(later(365), "0")]),
    ).toBeNull();
  });
});

// Tasas que el algoritmo acota (−99,999 % a +1.000.000 %): fuera de eso (7x en un día = 1e308 % al año)
// no tienen sentido y `computeXirr` devuelve null, que la pantalla muestra como "—".
const inRange = (rate: number) => rate > -0.99999 && rate < 1e6;

describe("propiedades", () => {
  it("un solo aporte sin flujos intermedios: XIRR = (V/F)^(365/días) − 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }), // aporte, en dólares
        fc.double({ min: 0.01, max: 1000, noNaN: true }), // razón V / F
        fc.integer({ min: 1, max: 2000 }), // días
        (deposit, ratio, days) => {
          const final = (deposit * ratio).toFixed(2);
          const expected = Math.pow(Number(final) / deposit, 365 / days) - 1;
          if (!inRange(expected)) return true;
          const xirr = computeXirr([
            flow(START, `-${deposit}`),
            flow(later(days), final),
          ]);
          if (xirr === null) return false;
          return (
            Math.abs(num(xirr) - expected) <=
            1e-8 * Math.max(1, Math.abs(expected))
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("el signo de la tasa es el de la ganancia", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 1500 }),
        (deposit, final, days) => {
          const expected = Math.pow(final / deposit, 365 / days) - 1;
          if (!inRange(expected)) return true;
          const xirr = computeXirr([
            flow(START, `-${deposit}`),
            flow(later(days), `${final}`),
          ]);
          if (xirr === null) return false;
          if (final > deposit) return num(xirr) > 0;
          if (final < deposit) return num(xirr) < 0;
          return Math.abs(num(xirr)) < 1e-9;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fuera de rango devuelve null en vez de un número absurdo", () => {
    // 7x en un día: la tasa anual no se puede representar.
    expect(
      computeXirr([flow(START, "-100"), flow(later(1), "700")]),
    ).toBeNull();
  });
});
