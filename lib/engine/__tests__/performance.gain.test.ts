import { describe, expect, it } from "vitest";
import { d, type Dec } from "../decimal";
import {
  computePerformance,
  periodCurve,
  type PeriodId,
  type PeriodResult,
} from "../performance";
import type { Transaction } from "../types";
import type { DailyClose } from "../valuation";
import { buy, deposit, sell, withdrawal } from "./helpers";

// Ganancia en dinero por período y su curva (Inicio v2): `V_t − V_base − Σ flujos externos`.
// Todo a mano; los depósitos y retiros NO son ganancia ni pérdida.

const closes = (rows: ReadonlyArray<readonly [string, string]>): DailyClose[] =>
  rows.map(([date, close]) => ({ date, close: d(close) }));

const byId = (periods: readonly PeriodResult[], id: PeriodId): PeriodResult => {
  const found = periods.find((p) => p.id === id);
  if (!found) throw new Error(`sin período ${id}`);
  return found;
};

const text = (value: Dec) => value.toFixed();

describe("ganancia con depósitos a mitad de período", () => {
  // Lun 21: depósito 1000 y compra de 10 a 100. Mar 22: 110. Mié 23: depósito 1100 y compra de
  // 10 más a 110. Jue 24: 121. Valores al cierre: 1000, 1100, 2200, 2420. Aportado: 1000, 1000,
  // 2100, 2100. Ganancia: 0, 100, 100, 320 (los 320 del comentario de performance.test.ts).
  const transactions: Transaction[] = [
    deposit("2026-09-21T15:00:00Z", "1000"),
    buy("2026-09-21T15:00:00Z", "VOO", "10", "100"),
    deposit("2026-09-23T15:00:00Z", "1100"),
    buy("2026-09-23T15:00:00Z", "VOO", "10", "110"),
  ];
  const result = computePerformance({
    transactions,
    closes: new Map([
      [
        "VOO",
        closes([
          ["2026-09-21", "100"],
          ["2026-09-22", "110"],
          ["2026-09-23", "110"],
          ["2026-09-24", "121"],
        ]),
      ],
    ]),
    benchmark: null,
    endDate: "2026-09-24",
  });
  const max = byId(result.periods, "MAX");

  it("en Todo la ganancia es el valor final menos lo aportado: 2420 − 2100 = 320", () => {
    expect(text(max.gain)).toBe("320");
  });

  it("la curva de Todo empieza en 0 y no salta con los depósitos", () => {
    const curve = periodCurve(result.series, null, max);
    expect(curve.map((p) => text(p.gain))).toEqual([
      "0", // día base: todavía no había portafolio
      "0", // lun 21: el valor (1000) es exactamente lo aportado
      "100", // mar 22
      "100", // mié 23: sube el valor a 2200, pero entraron 1100 de afuera
      "320", // jue 24
    ]);
    expect(text(curve.at(-1)!.gain)).toBe(text(max.gain));
  });

  it("un período con base adentro de la serie arranca en 0 con el valor de ese día", () => {
    // Base mar 22 (valor 1100). Mié 23: 2200 − 1100 − 1100 = 0. Jue 24: 2420 − 1100 − 1100 = 220
    // (10 unidades ganan 11 cada una desde el 22 y las otras 10, 11 desde el 23: 110 + 110).
    const curve = periodCurve(result.series, null, {
      baseDate: "2026-09-22",
      endDate: "2026-09-24",
    });
    expect(curve.map((p) => text(p.gain))).toEqual(["0", "0", "220"]);
  });

  it("los períodos recortados a Todo dan la misma ganancia", () => {
    for (const id of ["1S", "1M", "3M", "YTD", "1A"] as const) {
      expect(text(byId(result.periods, id).gain)).toBe("320");
    }
  });
});

describe("ganancia con un retiro", () => {
  // Lun 21: depósito 1000, compra de 10 a 100. Mar 22: 110 (valor 1100, ganancia 100).
  // Mié 23: vende 5 a 110 (efectivo 550) y retira 500: valor = 50 + 5 × 110 = 600, aportado neto
  // 500 → ganancia 100 (sacar plata no es perder). Jue 24: 121 → 50 + 5 × 121 = 655 → 155.
  const transactions: Transaction[] = [
    deposit("2026-09-21T15:00:00Z", "1000"),
    buy("2026-09-21T15:00:00Z", "VOO", "10", "100"),
    sell("2026-09-23T15:00:00Z", "VOO", "5", "110"),
    withdrawal("2026-09-23T15:00:00Z", "500"),
  ];
  const result = computePerformance({
    transactions,
    closes: new Map([
      [
        "VOO",
        closes([
          ["2026-09-21", "100"],
          ["2026-09-22", "110"],
          ["2026-09-23", "110"],
          ["2026-09-24", "121"],
        ]),
      ],
    ]),
    benchmark: null,
    endDate: "2026-09-24",
  });
  const max = byId(result.periods, "MAX");

  it("el retiro no aparece como pérdida", () => {
    const curve = periodCurve(result.series, null, max);
    expect(curve.map((p) => text(p.gain))).toEqual([
      "0",
      "0",
      "100",
      "100",
      "155",
    ]);
    expect(text(max.gain)).toBe("155");
  });
});

describe("ganancia negativa y comisiones", () => {
  it("una caída de precio y una comisión dan ganancia negativa", () => {
    // Depósito 1000; compra de 10 a 100 con 2 de comisión (efectivo −2 → hay que depositar 1002).
    const result = computePerformance({
      transactions: [
        deposit("2026-09-21T15:00:00Z", "1002"),
        buy("2026-09-21T15:00:00Z", "VOO", "10", "100", "2"),
      ],
      closes: new Map([
        [
          "VOO",
          closes([
            ["2026-09-21", "100"],
            ["2026-09-22", "95"],
          ]),
        ],
      ]),
      benchmark: null,
      endDate: "2026-09-22",
    });
    const curve = periodCurve(result.series, null, byId(result.periods, "MAX"));
    // Lun 21: 1000 de acciones + 0 de efectivo − 1002 aportado = −2 (la comisión).
    // Mar 22: 950 − 1002 = −52.
    expect(curve.map((p) => text(p.gain))).toEqual(["0", "-2", "-52"]);
  });
});

describe("ganancia de un período cuyo día base tiene un depósito", () => {
  // El valor del día base ya incluye lo que entró ese día: no puede restarse otra vez.
  // 1/9: depósito de 1000 y compra de 10 a 100 (valor 1000). 1/10: el cierre sube a 110 (1100).
  // El período de 1 mes arranca el 1/9 (día base) y gana 1100 − 1000 = 100.
  const result = computePerformance({
    transactions: [
      deposit("2026-09-01T15:00:00Z", "1000"),
      buy("2026-09-01T15:00:00Z", "VOO", "10", "100"),
    ],
    closes: new Map([
      [
        "VOO",
        closes([
          ["2026-09-01", "100"],
          ["2026-10-01", "110"],
        ]),
      ],
    ]),
    benchmark: null,
    endDate: "2026-10-01",
  });

  it("el flujo del día base no cuenta contra el período: 1100 − 1000 − 0 = 100", () => {
    const month = byId(result.periods, "1M");
    expect(month.baseDate).toBe("2026-09-01");
    expect(text(month.gain)).toBe("100");
    // Todo el historial (el día base es el anterior a la primera operación) da lo mismo.
    expect(text(byId(result.periods, "MAX").gain)).toBe("100");
  });
});
