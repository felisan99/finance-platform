import { describe, expect, it } from "vitest";
import {
  formatChartMoney,
  formatChartMoneySigned,
  formatChartPercent,
  formatChartThousandsTick,
  formatChartTick,
  formatDateKey,
  formatDayMonthKey,
} from "../chart-format";

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

describe("formatos de gráficos", () => {
  it("dinero con signo para el tooltip de la ganancia", () => {
    expect(plain(formatChartMoneySigned(320))).toBe("+US$ 320,00");
    expect(plain(formatChartMoneySigned(-52.5))).toBe("-US$ 52,50");
    expect(plain(formatChartMoneySigned(1234.5))).toBe("+US$ 1.234,50");
    // Cero: sin signo (ni "+0" ni "-0").
    expect(plain(formatChartMoneySigned(0))).toBe("US$ 0,00");
    expect(plain(formatChartMoneySigned(-0))).toBe("US$ 0,00");
  });

  it("porcentaje con signo y dos decimales, coma decimal", () => {
    expect(plain(formatChartPercent(5.06))).toBe("+5,06%");
    expect(plain(formatChartPercent(-0.0001))).toBe("0,00%");
    expect(plain(formatChartPercent(-12.5))).toBe("-12,50%");
    expect(plain(formatChartPercent(0))).toBe("0,00%");
  });

  it("los formatos que ya existían no cambian", () => {
    expect(plain(formatChartMoney(1234.5))).toBe("US$ 1.234,50");
    expect(formatChartTick(2500, 0)).toBe("2500");
    expect(formatDateKey("2026-09-23")).toBe("23/09/2026");
    expect(formatDayMonthKey("2026-09-23")).toBe("23/09");
  });

  it("marcas de un eje en miles, con los decimales del paso dividido", () => {
    expect(formatChartThousandsTick(250000, 0)).toBe("250 mil");
    expect(formatChartThousandsTick(2500, 1)).toBe("2,5 mil");
    expect(formatChartThousandsTick(1500000, 0)).toBe("1500 mil");
    expect(formatChartThousandsTick(0, 0)).toBe("0");
  });
});
