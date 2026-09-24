import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysBetween,
  isWeekday,
  marketDay,
  onOrAfterWeekday,
  onOrBeforeWeekday,
  previousWeekday,
  weekdaysBetween,
  yearOf,
} from "../dates";

// Referencias de calendario: 2026-09-21 es lunes, 2026-09-25 viernes, 2026-09-26 sábado,
// 2026-09-27 domingo. 2024 es bisiesto.

describe("addDays", () => {
  it("cruza meses y años", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2026-09-24", 0)).toBe("2026-09-24");
  });
});

describe("addMonths", () => {
  it("un mes calendario normal", () => {
    expect(addMonths("2026-09-24", -1)).toBe("2026-08-24");
    expect(addMonths("2026-09-24", -3)).toBe("2026-06-24");
    expect(addMonths("2026-09-24", -12)).toBe("2025-09-24");
    expect(addMonths("2026-09-24", 4)).toBe("2027-01-24");
  });

  it("si el día no existe en el mes de destino, queda en el último del mes", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29"); // bisiesto
    expect(addMonths("2026-05-31", -1)).toBe("2026-04-30");
    expect(addMonths("2024-02-29", -12)).toBe("2023-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("cruza el año hacia atrás", () => {
    expect(addMonths("2026-02-15", -3)).toBe("2025-11-15");
    expect(addMonths("2026-01-10", -1)).toBe("2025-12-10");
  });
});

describe("daysBetween", () => {
  it("cuenta días de calendario, con signo", () => {
    expect(daysBetween("2026-09-24", "2026-09-24")).toBe(0);
    expect(daysBetween("2026-09-24", "2026-09-25")).toBe(1);
    expect(daysBetween("2026-09-25", "2026-09-24")).toBe(-1);
    expect(daysBetween("2025-09-24", "2026-09-24")).toBe(365);
    expect(daysBetween("2023-09-24", "2024-09-24")).toBe(366); // cruza un 29/02
  });
});

describe("días hábiles", () => {
  it("isWeekday: lunes a viernes", () => {
    expect(isWeekday("2026-09-21")).toBe(true);
    expect(isWeekday("2026-09-25")).toBe(true);
    expect(isWeekday("2026-09-26")).toBe(false);
    expect(isWeekday("2026-09-27")).toBe(false);
  });

  it("un fin de semana pasa al lunes o vuelve al viernes; un día hábil se queda", () => {
    expect(onOrAfterWeekday("2026-09-26")).toBe("2026-09-28");
    expect(onOrAfterWeekday("2026-09-27")).toBe("2026-09-28");
    expect(onOrAfterWeekday("2026-09-24")).toBe("2026-09-24");
    expect(onOrBeforeWeekday("2026-09-27")).toBe("2026-09-25");
    expect(onOrBeforeWeekday("2026-09-26")).toBe("2026-09-25");
    expect(onOrBeforeWeekday("2026-09-24")).toBe("2026-09-24");
  });

  it("previousWeekday es estricto y salta el fin de semana", () => {
    expect(previousWeekday("2026-09-24")).toBe("2026-09-23");
    expect(previousWeekday("2026-09-28")).toBe("2026-09-25"); // lunes → viernes
    expect(previousWeekday("2026-09-27")).toBe("2026-09-25");
  });

  it("weekdaysBetween: extremos incluidos, sin fines de semana", () => {
    expect(weekdaysBetween("2026-09-24", "2026-09-29")).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-28",
      "2026-09-29",
    ]);
    expect(weekdaysBetween("2026-09-26", "2026-09-27")).toEqual([]);
    expect(weekdaysBetween("2026-09-26", "2026-09-28")).toEqual(["2026-09-28"]);
    expect(weekdaysBetween("2026-09-25", "2026-09-24")).toEqual([]);
    expect(weekdaysBetween("2026-09-24", "2026-09-24")).toEqual(["2026-09-24"]);
  });
});

describe("marketDay (hora de Nueva York)", () => {
  it("una operación de la noche en Montevideo sigue siendo del día de Nueva York", () => {
    // 15:00Z = 11:00 en Nueva York (EDT, UTC−4 en setiembre).
    expect(marketDay(new Date("2026-09-24T15:00:00Z"))).toBe("2026-09-24");
  });

  it("borde de medianoche UTC: 01:00Z todavía es la tarde/noche del día anterior en Nueva York", () => {
    // 2026-09-25T01:00Z = 2026-09-24 21:00 EDT.
    expect(marketDay(new Date("2026-09-25T01:00:00Z"))).toBe("2026-09-24");
    // 04:00Z = 00:00 EDT: recién ahí cambia el día.
    expect(marketDay(new Date("2026-09-25T03:59:59Z"))).toBe("2026-09-24");
    expect(marketDay(new Date("2026-09-25T04:00:00Z"))).toBe("2026-09-25");
  });

  it("respeta el horario de verano: en invierno el desfase es de 5 horas", () => {
    // 2026-01-06T04:59Z = 2026-01-05 23:59 EST; 05:00Z = 00:00 EST del 6.
    expect(marketDay(new Date("2026-01-06T04:59:00Z"))).toBe("2026-01-05");
    expect(marketDay(new Date("2026-01-06T05:00:00Z"))).toBe("2026-01-06");
  });
});

describe("yearOf", () => {
  it("toma el año de la fecha", () => {
    expect(yearOf("2026-09-24")).toBe(2026);
    expect(yearOf("1999-12-31")).toBe(1999);
  });
});
