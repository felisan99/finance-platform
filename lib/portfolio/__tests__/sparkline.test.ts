import { describe, expect, it } from "vitest";
import { sparklineGeometry } from "../sparkline";

describe("sparklineGeometry", () => {
  it("una serie creciente sube de izquierda a derecha (Y crece hacia abajo)", () => {
    // 10 × 10 sin margen: x en 0, 5, 10; el mínimo abajo (y = 10) y el máximo arriba (y = 0).
    const g = sparklineGeometry([1, 2, 3], 10, 10, 0);
    expect(g?.line).toBe("M0 10 L5 5 L10 0");
    expect(g?.end).toEqual({ x: 10, y: 0 });
  });

  it("una serie que baja termina abajo", () => {
    const g = sparklineGeometry([3, 1], 10, 10, 0);
    expect(g?.line).toBe("M0 0 L10 10");
    expect(g?.end).toEqual({ x: 10, y: 10 });
  });

  it("el margen encierra el trazo dentro del rectángulo", () => {
    // 100 × 40 con margen 2: x de 2 a 98; y de 2 (máximo) a 38 (mínimo).
    const g = sparklineGeometry([10, 20], 100, 40, 2);
    expect(g?.line).toBe("M2 38 L98 2");
  });

  it("una serie plana es una recta al medio, sin dividir por cero", () => {
    const g = sparklineGeometry([5, 5, 5], 10, 10, 0);
    expect(g?.line).toBe("M0 5 L5 5 L10 5");
  });

  it("los valores intermedios se reparten proporcionalmente", () => {
    // 0, 25, 100 en altura 100 sin margen: y = 100, 75, 0.
    const g = sparklineGeometry([0, 25, 100], 20, 100, 0);
    expect(g?.line).toBe("M0 100 L10 75 L20 0");
  });

  it("menos de dos puntos o valores no finitos: no hay trazo", () => {
    expect(sparklineGeometry([], 10, 10)).toBeNull();
    expect(sparklineGeometry([1], 10, 10)).toBeNull();
    expect(sparklineGeometry([1, Number.NaN], 10, 10)).toBeNull();
    expect(sparklineGeometry([1, Number.POSITIVE_INFINITY], 10, 10)).toBeNull();
  });

  it("todos los puntos caen dentro del rectángulo", () => {
    const values = [3.3, 9.1, 0.2, 7.7, 5.5, 5.5, 1.1];
    const g = sparklineGeometry(values, 96, 32);
    const numbers = (g?.line.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    for (let i = 0; i < numbers.length; i += 2) {
      expect(numbers[i]).toBeGreaterThanOrEqual(2);
      expect(numbers[i]).toBeLessThanOrEqual(94);
      expect(numbers[i + 1]).toBeGreaterThanOrEqual(2);
      expect(numbers[i + 1]).toBeLessThanOrEqual(30);
    }
  });
});
