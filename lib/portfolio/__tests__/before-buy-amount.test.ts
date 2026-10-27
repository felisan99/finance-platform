import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT,
  MIN_AMOUNT,
  impactRows,
  parseAmount,
  planView,
  type ImpactModel,
  type PlanModel,
} from "../before-buy-amount";

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string) => value.replace(/[  ]/g, " ");

const value = (raw: string) => {
  const parsed = parseAmount(raw);
  return parsed.ok ? parsed.value : null;
};
const message = (raw: string) => {
  const parsed = parseAmount(raw);
  return parsed.ok ? null : plain(parsed.message);
};

describe("parseAmount: lo que se escribe en «Otro»", () => {
  it("la forma de acá: punto de miles y coma decimal", () => {
    expect(value("1.500,50")).toBe(1501);
    expect(value("1.500")).toBe(1500);
    expect(value("1500,4")).toBe(1500);
    expect(value("1.000.000")).toBe(1_000_000);
    expect(value("250")).toBe(250);
  });

  it("la forma de la calculadora: punto decimal (y coma de miles)", () => {
    expect(value("1500.5")).toBe(1501);
    expect(value("12.5")).toBe(13);
    expect(value("1500.25")).toBe(1500);
    expect(value("1,500.50")).toBe(1501);
    expect(value("1,000,000")).toBe(1_000_000);
  });

  it("un punto con exactamente tres cifras detrás es de miles; una coma sola, decimal", () => {
    expect(value("3.270")).toBe(3270);
    expect(value("3,270")).toBe(3); // 3,27 dólares
    expect(value("0.500")).toBeNull(); // 0,5: menos de un dólar
  });

  it("acepta US$, $ y espacios (también los de no separación)", () => {
    expect(value("US$ 1.500")).toBe(1500);
    expect(value("$250")).toBe(250);
    expect(value(" 1 500 ")).toBe(1500);
    expect(value("usd 100")).toBe(100);
  });

  it("un separador al final o al principio (mientras se escribe) no rompe", () => {
    expect(value("1500,")).toBe(1500);
    expect(value("1500.")).toBe(1500);
    expect(value(",75")).toBeNull(); // 0,75: menos de un dólar
    expect(value("1,")).toBe(1);
  });

  it("vacío: pide un monto", () => {
    expect(message("")).toBe("Escribí un monto en dólares.");
    expect(message("   ")).toBe("Escribí un monto en dólares.");
    expect(message("US$")).toBe("Escribí un monto en dólares.");
  });

  it("letras, signos, varios decimales o miles mal agrupados: pide solo el número", () => {
    const hint = "Escribí solo el número, por ejemplo 1.500 o 1500,50.";
    for (const raw of [
      "abc",
      "-500",
      "1e3",
      "1,5,0",
      "1.50.0",
      "12.34,5,6",
      "1.5000,00",
      "1500,5.0",
      ".",
      ",",
    ]) {
      expect([raw, message(raw)]).toEqual([raw, hint]);
    }
  });

  it("fuera de rango: de US$ 1 a US$ 1.000.000", () => {
    const hint = "El monto va de US$ 1 a US$ 1.000.000.";
    expect(message("0")).toBe(hint);
    expect(message("0,99")).toBe(hint);
    expect(message("1.000.001")).toBe(hint);
    expect(message("99999999999999999999")).toBe(hint);
    expect(value("1")).toBe(MIN_AMOUNT);
    expect(value("1000000,4")).toBe(MAX_AMOUNT);
    expect(message("1000000,5")).toBe(hint); // redondea a 1.000.001
  });
});

describe("impactRows", () => {
  // Hoy: A 3.000, B 2.000, C 1.000, el candidato 500 (Tecnología, con A) y 3.500 de efectivo.
  const model: ImpactModel = {
    symbol: "NVDA",
    total: 10_000,
    candidate: 500,
    group: { label: "Tecnología", value: 3500 },
    others: [3000, 2000, 1000],
    volatility: { portfolio: 0.04, covariance: 0.03, candidate: 0.09 },
  };

  it("pesos de antes y después con plata nueva", () => {
    const rows = impactRows(model, 1000).map((r) => [
      r.label,
      plain(r.before),
      plain(r.after),
    ]);
    expect(rows).toEqual([
      ["NVDA en tu cartera", "5,00%", "13,64%"], // 1.500 / 11.000
      ["Tecnología", "35,00%", "40,91%"], // 4.500 / 11.000
      ["Tus 3 posiciones más grandes", "60,00%", "59,09%"], // 3.000 + 2.000 + 1.500
      ["Volatilidad (1 año)", "20,00%", "19,69%"],
    ]);
  });

  it("la volatilidad de después: √(0,04 + 2·0,1·0,03 + 0,01·0,09) / 1,1", () => {
    const after = Math.sqrt(0.04 + 2 * 0.1 * 0.03 + 0.01 * 0.09) / 1.1;
    expect(plain(impactRows(model, 1000)[3]!.after)).toBe(
      `${(after * 100).toFixed(2).replace(".", ",")}%`,
    );
  });

  it("sin grupo, con pocas posiciones y sin volatilidad medible: solo la fila del candidato", () => {
    const small: ImpactModel = {
      ...model,
      group: null,
      others: [3000],
      volatility: null,
    };
    expect(impactRows(small, 100).map((r) => r.label)).toEqual([
      "NVDA en tu cartera",
    ]);
  });

  it("monto o total que no son positivos: sin filas", () => {
    expect(impactRows(model, 0)).toEqual([]);
    expect(impactRows(model, Number.NaN)).toEqual([]);
    expect(impactRows({ ...model, total: 0 }, 100)).toEqual([]);
  });

  it("un monto enorme deja al candidato cerca del 100%", () => {
    expect(plain(impactRows(model, 1_000_000)[0]!.after)).toBe("99,06%");
  });
});

describe("planView", () => {
  const plan: PlanModel = {
    since: "desde octubre de 2025 (12 aportes)",
    invested: 12,
    value: 13.5,
    gain: { text: "+12,50%", tone: "gain" },
    benchmark: {
      label: "S&P 500",
      value: 12.6,
      gain: { text: "+5,00%", tone: "gain" },
    },
  };

  it("escala lo aportado y el valor con el monto; el porcentaje queda igual", () => {
    const view = planView(plan, 1500);
    expect(plain(view.heading)).toBe(
      "US$ 1.500 por mes desde octubre de 2025 (12 aportes)",
    );
    expect(plain(view.invested)).toBe("US$ 18.000,00");
    expect(plain(view.value)).toBe("US$ 20.250,00");
    expect(view.gain).toEqual(plan.gain);
    expect(plain(view.benchmark!.text)).toBe(
      "Lo mismo en S&P 500: US$ 18.900,00",
    );
  });

  it("sin benchmark", () => {
    expect(planView({ ...plan, benchmark: null }, 100).benchmark).toBeNull();
  });
});
