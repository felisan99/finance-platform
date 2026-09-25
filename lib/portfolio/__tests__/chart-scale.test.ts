import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { niceScale } from "../chart-scale";

describe("niceScale", () => {
  it("valores de un portafolio: marcas cada 2.500 (rango 8.200 en 4 intervalos → paso 2.050 → 2.500)", () => {
    const scale = niceScale(2900, 11100);
    expect(scale.ticks).toEqual([2500, 5000, 7500, 10000, 12500]);
    expect(scale.domain).toEqual([2500, 12500]);
    expect(scale.decimals).toBe(0);
  });

  it("un índice base 100: incluye el 100 en las marcas (rango 7,2 → paso 1,8 → 2)", () => {
    const scale = niceScale(99.4, 106.6);
    expect(scale.ticks).toEqual([98, 100, 102, 104, 106, 108]);
    expect(scale.ticks).toContain(100);
  });

  it("rangos chicos piden decimales para que las marcas no se repitan", () => {
    // rango 0,8 → paso 0,2
    const scale = niceScale(99.6, 100.4);
    expect(scale.ticks).toEqual([99.6, 99.8, 100, 100.2, 100.4]);
    expect(scale.decimals).toBe(1);
    // rango 0,04 → paso 0,01
    expect(niceScale(100, 100.04).decimals).toBe(2);
  });

  it("los pasos son 1, 2, 2,5, 5 × 10^k", () => {
    expect(niceScale(0, 100).ticks).toEqual([0, 25, 50, 75, 100]);
    expect(niceScale(0, 8).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale(0, 400).ticks).toEqual([0, 100, 200, 300, 400]);
    expect(niceScale(0, 1_000_000).ticks).toEqual([
      0, 250_000, 500_000, 750_000, 1_000_000,
    ]);
  });

  it("datos constantes: abre un margen y no se cae", () => {
    const scale = niceScale(100, 100);
    expect(scale.domain[0]).toBeLessThan(100);
    expect(scale.domain[1]).toBeGreaterThan(100);
    const zero = niceScale(0, 0);
    expect(zero.domain[0]).toBeLessThan(0);
    expect(zero.domain[1]).toBeGreaterThan(0);
  });

  it("valores negativos", () => {
    const scale = niceScale(-3, 5);
    expect(scale.ticks).toEqual([-4, -2, 0, 2, 4, 6]);
  });

  it("un rango minúsculo respecto de la magnitud cuenta como dato constante (sin marcas repetidas)", () => {
    const scale = niceScale(100, 100 + 1e-9);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
    expect(scale.ticks.length).toBeLessThanOrEqual(9);
    expect(scale.ticks.every((t, i, all) => i === 0 || t > all[i - 1]!)).toBe(
      true,
    );
    expect(scale.domain[0]).toBeLessThan(100);
    expect(scale.domain[1]).toBeGreaterThan(100);
  });

  it("un paso de 2,5 lleva un decimal: 342,5 no se muestra como 343", () => {
    const scale = niceScale(333, 342);
    expect(scale.ticks).toEqual([332.5, 335, 337.5, 340, 342.5]);
    expect(scale.decimals).toBe(1);
  });

  it("un paso de 0,25 lleva dos decimales: 0,25 no se muestra como 0,3", () => {
    const scale = niceScale(0.1, 1.1);
    expect(scale.ticks).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25]);
    expect(scale.decimals).toBe(2);
  });

  it("un paso de 25 o de 250 es entero: no hay decimales de más", () => {
    expect(niceScale(0, 100).decimals).toBe(0);
    expect(niceScale(0, 1000).decimals).toBe(0);
  });

  it("las marcas nunca se repiten al redondear con los decimales de la escala", () => {
    for (const [min, max] of [
      [333, 342],
      [0.1, 1.1],
      [98.4, 103.1],
      [1.2, 1.26],
      [0, 7],
      [2900, 3120],
    ] as const) {
      const scale = niceScale(min, max);
      const shown = scale.ticks.map((t) => t.toFixed(scale.decimals));
      expect(new Set(shown).size).toBe(shown.length);
      // Y cada marca se muestra exacta, sin redondearla.
      scale.ticks.forEach((t, i) => {
        expect(Number(shown[i])).toBeCloseTo(t, 9);
      });
    }
  });

  it("propiedad: el dominio contiene a los datos, las marcas están ordenadas y son pocas", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e7, max: 1e7, noNaN: true }),
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        (start, span) => {
          const end = start + span;
          const scale = niceScale(start, end);
          const [low, high] = scale.domain;
          // Tolerancia relativa: la escala ignora diferencias de 1e-9 pasos (ruido de coma flotante).
          const tolerance =
            1e-8 * Math.max(span, Math.abs(start), Math.abs(end), 1);
          const sorted = scale.ticks.every(
            (t, i, all) => i === 0 || t > all[i - 1]!,
          );
          return (
            low <= start + tolerance &&
            high >= end - tolerance &&
            sorted &&
            scale.ticks.length >= 2 &&
            scale.ticks.length <= 9
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
