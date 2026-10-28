import { describe, expect, it } from "vitest";
import {
  defaultTradeRange,
  monthsBefore,
  rangeStart,
  sliceByRange,
  tickFormatFor,
} from "../trade-chart-range";

const points = [
  "2021-10-28",
  "2025-10-28",
  "2026-07-15",
  "2026-09-01",
  "2026-10-01",
  "2026-10-28",
].map((date) => ({ date, close: 1 }));
const markers = [
  { date: "2025-10-28", type: "BUY" },
  { date: "2026-07-15", type: "BUY" },
  { date: "2026-10-01", type: "SELL" },
];

describe("monthsBefore", () => {
  it("resta meses y, si el día no existe, usa el último del mes", () => {
    expect(monthsBefore("2026-10-28", 1)).toBe("2026-09-28");
    expect(monthsBefore("2026-03-31", 1)).toBe("2026-02-28");
    expect(monthsBefore("2024-03-31", 1)).toBe("2024-02-29");
    expect(monthsBefore("2026-01-15", 12)).toBe("2025-01-15");
    expect(monthsBefore("2026-10-28", 60)).toBe("2021-10-28");
  });
});

describe("rangeStart y defaultTradeRange", () => {
  it("'Desde tu compra' usa el inicio de la tenencia; los demás cuentan hacia atrás desde el final", () => {
    expect(rangeStart("since", "2026-10-28", "2025-10-21")).toBe("2025-10-21");
    expect(rangeStart("3m", "2026-10-28", "2025-10-21")).toBe("2026-07-28");
    expect(rangeStart("since", "2026-10-28", null)).toBeNull();
  });

  it("abre en 'Desde tu compra' si hay operaciones; si no, en un año", () => {
    expect(defaultTradeRange("2025-10-21")).toBe("since");
    expect(defaultTradeRange(null)).toBe("1y");
  });
});

describe("sliceByRange", () => {
  it("un rango corto muestra solo sus operaciones y avisa cuántas quedaron antes", () => {
    const slice = sliceByRange(points, markers, "3m", "2025-10-21");
    expect(slice.points.map((p) => p.date)).toEqual([
      "2026-09-01",
      "2026-10-01",
      "2026-10-28",
    ]);
    expect(slice.markers).toEqual([{ date: "2026-10-01", type: "SELL" }]);
    expect(slice.hiddenBefore).toBe(2);
  });

  it("un rango largo muestra la historia anterior a la primera compra", () => {
    const slice = sliceByRange(points, markers, "5y", "2025-10-21");
    expect(slice.points).toHaveLength(6);
    expect(slice.markers).toHaveLength(3);
    expect(slice.hiddenBefore).toBe(0);
  });

  it("'Desde tu compra' arranca en la tenencia; sin inicio ni puntos, devuelve todo", () => {
    expect(
      sliceByRange(points, markers, "since", "2025-10-21").points[0]?.date,
    ).toBe("2025-10-28");
    expect(sliceByRange(points, markers, "since", null).points).toHaveLength(6);
    expect(sliceByRange([], [], "1y", null)).toEqual({
      points: [],
      markers: [],
      hiddenBefore: 0,
    });
  });
});

describe("tickFormatFor", () => {
  it("más de un año: mes/año; si no: día/mes", () => {
    expect(tickFormatFor("2021-10-28", "2026-10-28")("2023-03-19")).toBe(
      "03/23",
    );
    expect(tickFormatFor("2026-07-28", "2026-10-28")("2026-08-19")).toBe(
      "19/08",
    );
    expect(tickFormatFor(undefined, undefined)("2026-08-19")).toBe("19/08");
  });
});
