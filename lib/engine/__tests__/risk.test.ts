import { describe, expect, it } from "vitest";
import { addDays, isWeekday } from "../dates";
import { ZERO, d } from "../decimal";
import { MIN_VOLATILITY_DAYS, computeRisk } from "../risk";
import type { SeriesPoint } from "../series";

// Riesgo (Inicio v2): caída máxima, volatilidad y mejor/peor día sobre el índice TWR.
// Los vectores son a mano; la volatilidad se contrasta con la fórmula calculada aparte
// (desvío muestral × √252).

/** Días hábiles consecutivos a partir del siguiente a `base`, con su `growth` (`null` = sin base). */
function series(
  base: string,
  growths: ReadonlyArray<string | null>,
): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  let day = base;
  for (const growth of growths) {
    do day = addDays(day, 1);
    while (!isWeekday(day));
    points.push({
      date: day,
      value: ZERO,
      cash: ZERO,
      marketValue: ZERO,
      flow: ZERO,
      growth: growth === null ? null : d(growth),
      unpriced: [],
    });
  }
  return points;
}

const BASE = "2026-01-02"; // viernes

describe("caída máxima", () => {
  // Índice: 100 → 110 (máximo) → 99 → 94,05 (mínimo) → 112,86 (nuevo máximo).
  const points = series(BASE, ["1.1", "0.9", "0.95", "1.2"]);
  const risk = computeRisk(points, BASE, "2026-01-08")!;

  it("es la mayor baja desde un máximo: 94,05 / 110 − 1 = −14,5 %", () => {
    expect(risk.maxDrawdown!.depth.toFixed()).toBe("-0.145");
  });

  it("dice cuándo fue el máximo, el mínimo y cuándo se recuperó", () => {
    expect(risk.maxDrawdown).toMatchObject({
      peakDate: "2026-01-05",
      troughDate: "2026-01-07",
      recoveredDate: "2026-01-08",
    });
  });

  it("terminó en un máximo nuevo: caída actual 0", () => {
    expect(risk.currentDrawdown.toFixed()).toBe("0");
  });

  it("la curva de caídas arranca en 0 en el día base y tiene un punto por día", () => {
    expect(risk.curve.map((p) => [p.date, p.drawdown.toFixed()])).toEqual([
      [BASE, "0"],
      ["2026-01-05", "0"],
      ["2026-01-06", "-0.1"],
      ["2026-01-07", "-0.145"],
      ["2026-01-08", "0"],
    ]);
  });

  it("mejor y peor día", () => {
    expect(risk.bestDay).toEqual({
      date: "2026-01-08",
      value: d("0.2"),
    });
    expect(risk.worstDay).toEqual({
      date: "2026-01-06",
      value: d("-0.1"),
    });
    expect(risk.days).toBe(4);
  });
});

describe("caída sin recuperar", () => {
  const points = series(BASE, ["1.1", "0.9"]);
  const risk = computeRisk(points, BASE, "2026-01-06")!;

  it("no hay fecha de recuperación y la caída actual es la máxima", () => {
    expect(risk.maxDrawdown!.depth.toFixed()).toBe("-0.1");
    expect(risk.maxDrawdown!.recoveredDate).toBeNull();
    expect(risk.currentDrawdown.toFixed()).toBe("-0.1");
  });
});

describe("recuperación de una caída que no es la máxima", () => {
  it("solo cuenta la recuperación de la peor caída", () => {
    // 100 → 90 (−10 %, se recupera enseguida) → 108 (máximo) → 81 (−25 %, la peor) → 97,2.
    const risk = computeRisk(
      series(BASE, ["0.9", "1.2", "0.75", "1.2"]),
      BASE,
      "2026-01-08",
    )!;
    expect(risk.maxDrawdown!.depth.toFixed()).toBe("-0.25");
    expect(risk.maxDrawdown!.peakDate).toBe("2026-01-06");
    expect(risk.maxDrawdown!.troughDate).toBe("2026-01-07");
    // Después del mínimo solo llega a 97,2: no vuelve a los 108. La recuperación de la primera
    // caída (el 6) no es la de la peor.
    expect(risk.maxDrawdown!.recoveredDate).toBeNull();
    expect(risk.currentDrawdown.toFixed()).toBe("-0.1");
  });
});

describe("sin caídas", () => {
  it("un índice que solo sube no tiene caída máxima", () => {
    const risk = computeRisk(
      series(BASE, ["1.01", "1.02"]),
      BASE,
      "2026-01-06",
    )!;
    expect(risk.maxDrawdown).toBeNull();
    expect(risk.currentDrawdown.toFixed()).toBe("0");
  });
});

describe("días sin retorno y límites del período", () => {
  it("un día sin base (growth null) deja el índice igual y no cuenta como día", () => {
    const risk = computeRisk(
      series(BASE, [null, "1.1", null, "0.9"]),
      BASE,
      "2026-01-08",
    )!;
    expect(risk.days).toBe(2);
    // El índice sigue en 100 hasta el 6, sube a 110 y baja a 99 el 8.
    expect(risk.curve.map((p) => p.drawdown.toFixed())).toEqual([
      "0",
      "0",
      "0",
      "0",
      "-0.1",
    ]);
  });

  it("ignora lo que está en o antes del día base y lo posterior al final", () => {
    const points = series("2025-12-30", ["0.5", "0.5", "1.1", "0.9", "0.5"]);
    // Fechas: 12-31, 01-01, 01-02, 01-05, 01-06. Período (01-01, 01-05].
    const risk = computeRisk(points, "2026-01-01", "2026-01-05")!;
    expect(risk.days).toBe(2);
    expect(risk.maxDrawdown!.depth.toFixed()).toBe("-0.1");
  });

  it("sin ningún día con retorno no hay riesgo que mostrar", () => {
    expect(computeRisk([], BASE, "2026-01-08")).toBeNull();
    expect(
      computeRisk(series(BASE, [null, null]), BASE, "2026-01-06"),
    ).toBeNull();
  });
});

describe("mejor y peor día con empates", () => {
  it("gana el primero que aparece", () => {
    const risk = computeRisk(
      series(BASE, ["1.05", "1.05", "0.97", "0.97"]),
      BASE,
      "2026-01-08",
    )!;
    expect(risk.bestDay!.date).toBe("2026-01-05");
    expect(risk.worstDay!.date).toBe("2026-01-07");
  });
});

describe("volatilidad", () => {
  it(`con menos de ${MIN_VOLATILITY_DAYS} días no se calcula`, () => {
    const g = Array.from({ length: MIN_VOLATILITY_DAYS - 1 }, (_, i) =>
      i % 2 === 0 ? "1.01" : "0.99",
    );
    expect(
      computeRisk(series(BASE, g), BASE, "2026-03-31")!.volatility,
    ).toBeNull();
  });

  it("20 retornos de ±1 %: desvío muestral × √252 = 16,2869 %", () => {
    const g = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? "1.01" : "0.99",
    );
    const risk = computeRisk(series(BASE, g), BASE, "2026-03-31")!;
    expect(risk.volatility).toBeCloseTo(0.1628690142091911, 12);
  });

  it("una secuencia irregular (contrastada con la fórmula aparte)", () => {
    const g = Array.from({ length: 4 }, () => [
      "1.02",
      "0.99",
      "1",
      "1.03",
      "0.98",
    ]).flat();
    const risk = computeRisk(series(BASE, g), BASE, "2026-03-31")!;
    expect(risk.volatility).toBeCloseTo(0.3020770205027014, 12);
  });

  it("los días sin base no cuentan para el mínimo de días", () => {
    // 19 retornos + 1 día sin base = 20 filas, pero solo 19 observaciones.
    const g: Array<string | null> = Array.from({ length: 19 }, (_, i) =>
      i % 2 === 0 ? "1.01" : "0.99",
    );
    g.splice(5, 0, null);
    expect(
      computeRisk(series(BASE, g), BASE, "2026-03-31")!.volatility,
    ).toBeNull();
  });

  it("un índice constante tiene volatilidad 0", () => {
    const g = Array.from({ length: 20 }, () => "1");
    expect(computeRisk(series(BASE, g), BASE, "2026-03-31")!.volatility).toBe(
      0,
    );
  });
});

describe("el día del máximo y la recuperación exacta", () => {
  it("si el índice se queda en el máximo, la caída arranca desde el último día ahí", () => {
    // 100 → 110 (5/1) → 110 (6/1, sin cambio) → 99 (7/1): el máximo se sostuvo dos días.
    const risk = computeRisk(
      series(BASE, ["1.1", "1", "0.9"]),
      BASE,
      "2026-01-07",
    )!;
    expect(risk.maxDrawdown!.peakDate).toBe("2026-01-06");
    expect(risk.maxDrawdown!.troughDate).toBe("2026-01-07");
    // Antes del primer movimiento el máximo es el propio día base: 100 → 90 arranca el 2/1.
    const early = computeRisk(
      series(BASE, ["1", "1", "0.9"]),
      BASE,
      "2026-01-07",
    )!;
    expect(early.maxDrawdown!.peakDate).toBe("2026-01-06");
  });

  it("volver exactamente al máximo cuenta como recuperación", () => {
    // 100 → 120 → 96 → 120 (96 × 1,25 = 120 exacto).
    const risk = computeRisk(
      series(BASE, ["1.2", "0.8", "1.25"]),
      BASE,
      "2026-01-07",
    )!;
    expect(risk.maxDrawdown!.depth.toFixed()).toBe("-0.2");
    expect(risk.maxDrawdown!.recoveredDate).toBe("2026-01-07");
    expect(risk.currentDrawdown.toFixed()).toBe("0");
  });
});
