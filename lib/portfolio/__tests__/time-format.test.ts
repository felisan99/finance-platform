import { describe, expect, it } from "vitest";
import { d } from "@/lib/engine";
import {
  EMPTY,
  formatChartIndex,
  formatChartMoney,
  formatDateKey,
  formatDate,
  formatDateTime,
  formatDayHeader,
  formatDayMonth,
  formatMoney,
  formatPercent,
  formatPoints,
  formatPrice,
  formatQuantity,
} from "../format";
import {
  localDateKey,
  localYear,
  parseLocalInput,
  toLocalInput,
} from "../time";

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string) => value.replace(/[  ]/g, " ");

describe("formatMoney", () => {
  it.each([
    ["1234.56", "US$ 1.234,56"],
    ["0", "US$ 0,00"],
    ["12345678.9", "US$ 12.345.678,90"],
    ["-1234.56", "-US$ 1.234,56"],
    ["0.005", "US$ 0,01"], // mitad hacia arriba, como decimal.js y numeric de Postgres
    ["0.004", "US$ 0,00"],
    ["1730.98", "US$ 1.730,98"],
  ])("%s → %s", (input, expected) => {
    expect(plain(formatMoney(d(input)))).toBe(expected);
  });

  it("con signo: + para ganancias, - para pérdidas y nada para cero", () => {
    expect(plain(formatMoney(d("429.83"), { signed: true }))).toBe(
      "+US$ 429,83",
    );
    expect(plain(formatMoney(d("-38.76194"), { signed: true }))).toBe(
      "-US$ 49,31",
    );
    expect(plain(formatMoney(d("0"), { signed: true }))).toBe("US$ 0,00");
  });

  it("un valor que redondea a cero no lleva signo (sin '-0,00')", () => {
    expect(plain(formatMoney(d("-0.004")))).toBe("US$ 0,00");
    expect(plain(formatMoney(d("-0.004"), { signed: true }))).toBe("US$ 0,00");
    expect(plain(formatMoney(d("0.0049"), { signed: true }))).toBe("US$ 0,00");
  });

  it("no pierde dígitos: pasa el decimal exacto, no un float", () => {
    expect(plain(formatMoney(d("9007199254740993.01")))).toBe(
      "US$ 9.007.199.254.740.993,01",
    );
    expect(plain(formatMoney(d("0.30000000000000004")))).toBe("US$ 0,30");
  });

  it("null se muestra como raya, no como cero", () => {
    expect(formatMoney(null)).toBe(EMPTY);
  });
});

describe("formatPercent", () => {
  it.each([
    ["0.0682", "6,82%"],
    ["0", "0,00%"],
    ["1", "100,00%"],
    ["-0.0091", "-0,91%"],
    ["0.12345", "12,35%"], // 12,345 → mitad hacia arriba
  ])("%s → %s", (input, expected) => {
    expect(plain(formatPercent(d(input)))).toBe(expected);
  });

  it("con signo", () => {
    expect(plain(formatPercent(d("0.0682"), { signed: true }))).toBe("+6,82%");
    expect(plain(formatPercent(d("-0.0091"), { signed: true }))).toBe("-0,91%");
    expect(plain(formatPercent(d("-0.00001"), { signed: true }))).toBe("0,00%");
  });

  it("null: raya", () => {
    expect(formatPercent(null)).toBe(EMPTY);
  });
});

describe("formatQuantity y formatPrice", () => {
  it.each([
    ["8.95", "8,95"],
    ["10", "10"],
    ["1234.5", "1.234,5"],
    ["0.12345678", "0,12345678"],
    ["1234567.12345678", "1.234.567,12345678"],
    ["0.000000001", "0"], // por debajo de la tolerancia de cantidad (1e-9)
  ])("cantidad %s → %s", (input, expected) => {
    expect(plain(formatQuantity(d(input)))).toBe(expected);
  });

  it.each([
    ["707.6", "707,60"],
    ["251.41", "251,41"],
    ["0.5123", "0,5123"],
    ["575.24", "575,24"],
    ["1730.97998", "1.730,98"],
  ])("precio %s → %s", (input, expected) => {
    expect(plain(formatPrice(d(input)))).toBe(expected);
  });

  it("null: raya", () => {
    expect(formatQuantity(null)).toBe(EMPTY);
    expect(formatPrice(null)).toBe(EMPTY);
  });
});

describe("fechas en hora de Montevideo", () => {
  it("formatea el instante UTC en UTC−3", () => {
    const at = new Date("2026-03-09T22:34:00Z");
    expect(formatDate(at)).toBe("09/03/2026");
    expect(formatDateTime(at)).toBe("09/03/2026 19:34");
    expect(formatDayMonth(at)).toBe("09/03");
  });

  it("una operación de las 22:30 UTC del 6/3 ya es del mismo día en Montevideo (19:30)", () => {
    expect(localDateKey(new Date("2026-03-06T22:30:00Z"))).toBe("2026-03-06");
  });

  it("el día de Montevideo empieza a las 03:00 UTC: antes de esa hora sigue siendo el anterior", () => {
    expect(localDateKey(new Date("2026-03-07T02:59:00Z"))).toBe("2026-03-06");
    expect(localDateKey(new Date("2026-03-07T03:00:00Z"))).toBe("2026-03-07");
  });

  it("borde de año: 02:59:59Z del 1/1 todavía es 2025 en Montevideo", () => {
    expect(localYear(new Date("2026-01-01T02:59:59Z"))).toBe(2025);
    expect(localYear(new Date("2026-01-01T03:00:00Z"))).toBe(2026);
  });

  it("encabezado de día con la ortografía uruguaya", () => {
    expect(formatDayHeader("2026-09-23")).toBe("miércoles, 23 de setiembre");
    expect(formatDayHeader("2026-03-09")).toBe("lunes, 9 de marzo");
  });
});

describe("datetime-local ↔ UTC", () => {
  it("toLocalInput: instante UTC → valor del input en hora de Montevideo", () => {
    expect(toLocalInput(new Date("2026-03-09T22:34:00Z"))).toBe(
      "2026-03-09T19:34",
    );
  });

  it("parseLocalInput: lo que escribe el usuario (Montevideo) → UTC", () => {
    expect(parseLocalInput("2026-03-09T19:34")?.toISOString()).toBe(
      "2026-03-09T22:34:00.000Z",
    );
    expect(parseLocalInput("2026-09-23T00:00")?.toISOString()).toBe(
      "2026-09-23T03:00:00.000Z",
    );
    expect(parseLocalInput("2026-03-09T19:34:56")?.toISOString()).toBe(
      "2026-03-09T22:34:56.000Z",
    );
  });

  it("ida y vuelta sin cambios", () => {
    for (const iso of [
      "2026-01-01T00:00:00Z",
      "2026-06-15T13:45:00Z",
      "2025-12-31T23:59:00Z",
    ]) {
      const at = new Date(iso);
      expect(parseLocalInput(toLocalInput(at))?.toISOString()).toBe(
        at.toISOString(),
      );
    }
  });

  it("acepta espacios alrededor", () => {
    expect(parseLocalInput("  2026-03-09T19:34  ")).not.toBeNull();
  });

  it.each([
    "",
    "hoy",
    "2026-03-09",
    "2026-03-09 19:34",
    "2026-02-31T10:00",
    "2026-13-01T10:00",
    "2026-03-09T25:00",
    "2026-03-09T24:00", // date-fns-tz lo toma como las 00:00 del MISMO día: la ida y vuelta lo rechaza
    "2026-03-09T24:30",
    "2026-03-09T19:60",
    "0000-01-01T00:00",
    "09/03/2026 19:34",
    "2026-03-09T19:34Z",
    "2026-03-09T19:34+02:00",
  ])("rechaza %j", (text) => {
    expect(parseLocalInput(text)).toBeNull();
  });
});

describe("formatDateKey", () => {
  it("una fecha de calendario sin tocar la zona horaria", () => {
    expect(formatDateKey("2026-09-23")).toBe("23/09/2026");
    expect(formatDateKey("2027-01-05")).toBe("05/01/2027");
  });
});

describe("formatPoints", () => {
  it("diferencia de rendimientos en puntos porcentuales, con signo", () => {
    expect(plain(formatPoints(d("0.16")))).toBe("+16,00 pp");
    expect(plain(formatPoints(d("-0.0325")))).toBe("-3,25 pp");
    expect(plain(formatPoints(d("0")))).toBe("0,00 pp");
    expect(formatPoints(null)).toBe(EMPTY);
  });
});

describe("formatos de gráfico (reciben number)", () => {
  it("dinero e índice en es-UY", () => {
    expect(plain(formatChartMoney(10468.73))).toBe("US$ 10.468,73");
    expect(formatChartIndex(105)).toBe("105,00");
    expect(formatChartIndex(100.98039)).toBe("100,98");
  });
});
