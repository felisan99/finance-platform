import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { D, QTY_EPSILON, ZERO, d } from "../decimal";

describe("decimal", () => {
  it("suma decimales sin el error de los floats", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // referencia: por esto el dinero no usa floats
    expect(d("0.1").plus(d("0.2")).toFixed()).toBe("0.3");
  });

  it("mantiene 40 dígitos significativos", () => {
    const third = d("1").div(d("3")).toFixed();
    expect(third).toBe("0." + "3".repeat(40));
  });

  it("no se ve afectado por un Decimal.set global", () => {
    const { precision, rounding } = Decimal;
    Decimal.set({ precision: 5, rounding: Decimal.ROUND_DOWN });
    try {
      expect(new Decimal(1).div(3).toFixed()).toBe("0.33333"); // el global sí cambió
      expect(d("1").div(d("3")).toFixed()).toBe("0." + "3".repeat(40));
      expect(d("2").div(d("3")).toFixed()).toBe("0." + "6".repeat(39) + "7"); // HALF_UP
    } finally {
      Decimal.set({ precision, rounding });
    }
  });

  it("expone las constantes del motor", () => {
    expect(ZERO.isZero()).toBe(true);
    expect(QTY_EPSILON.toFixed()).toBe("0.000000001");
  });

  it("d() acepta un Decimal existente sin alterarlo", () => {
    const x = d("12.345");
    expect(d(x).equals(x)).toBe(true);
    expect(d(x)).toBeInstanceOf(D);
  });
});
