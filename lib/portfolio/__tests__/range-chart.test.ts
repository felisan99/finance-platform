import { describe, expect, it } from "vitest";
import {
  buildRangeSeries,
  dailyInput,
  intradayInput,
  sliceDaily,
  type RangeInputPoint,
} from "../range-chart";

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string) => value.replace(/[  ]/g, " ");

const pt = (day: string, close: string, label = day): RangeInputPoint => ({
  label,
  day,
  close,
});
const NO_52 = { low: null, high: null };

/** Dos barras por rueda durante las ruedas indicadas, subiendo de a poco. */
function bars(days: string[], start = 100): RangeInputPoint[] {
  return days.flatMap((day, i) => [
    pt(day, String(start + i), `${day} 13:30`),
    pt(day, String(start + i + 0.5), `${day} 14:00`),
  ]);
}

describe("buildRangeSeries: lo básico", () => {
  it("con menos de dos puntos no hay línea", () => {
    expect(
      buildRangeSeries({
        range: "1y",
        source: "daily",
        points: [],
        week52: NO_52,
      }),
    ).toBeNull();
    expect(
      buildRangeSeries({
        range: "1y",
        source: "daily",
        points: [pt("2026-09-25", "100")],
        week52: NO_52,
      }),
    ).toBeNull();
  });

  it("un cierre roto (cero, negativo, no numérico) se descarta; con dos buenos alcanza", () => {
    const series = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: [
        pt("2026-09-22", "100"),
        pt("2026-09-23", "abc"),
        pt("2026-09-24", "0"),
        pt("2026-09-25", "110"),
      ],
      week52: NO_52,
    })!;
    expect(series.points.map((p) => p.close)).toEqual([100, 110]);
  });

  it("el cambio va del primer al último punto, con signo y porcentaje", () => {
    const series = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: [pt("2026-09-22", "100"), pt("2026-09-25", "103.2")],
      week52: NO_52,
    })!;
    expect(plain(series.change!.text)).toBe("+US$ 3,20");
    expect(series.change!.pctText).toMatch(/^\+3,20\s?%$/);
    expect(series.change!.tone).toBe("gain");
  });

  it("una baja es «loss» y un cambio que redondea a cero es «flat»", () => {
    const down = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: [pt("2026-09-22", "100"), pt("2026-09-25", "90")],
      week52: NO_52,
    })!;
    expect(down.change!.tone).toBe("loss");
    expect(plain(down.change!.text)).toBe("-US$ 10,00");
    const flat = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: [pt("2026-09-22", "100"), pt("2026-09-25", "100.004")],
      week52: NO_52,
    })!;
    expect(flat.change!.tone).toBe("flat");
  });

  it("una serie plana tiene escala igual (no colapsa)", () => {
    const series = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: [pt("2026-09-22", "100"), pt("2026-09-25", "100")],
      week52: NO_52,
    })!;
    expect(series.domain[0]).toBeLessThan(100);
    expect(series.domain[1]).toBeGreaterThan(100);
  });

  it("la escala deja aire arriba y abajo", () => {
    const series = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: [pt("2026-09-22", "100"), pt("2026-09-25", "110")],
      week52: NO_52,
    })!;
    expect(series.domain[0]).toBeCloseTo(99.2, 5);
    expect(series.domain[1]).toBeCloseTo(110.8, 5);
  });

  it("la descripción para lectores de pantalla dice el rango, los extremos y el cambio", () => {
    const series = buildRangeSeries({
      range: "1m",
      source: "intraday",
      points: [
        pt("2026-09-01", "100", "01/09 13:30"),
        pt("2026-09-25", "110", "25/09 20:00"),
      ],
      week52: NO_52,
    })!;
    expect(plain(series.description)).toBe(
      "Gráfico del precio de 1 mes, de 01/09 13:30 a 25/09 20:00: pasó de US$ 100,00 a US$ 110,00 (+US$ 10,00, +10,00%).",
    );
  });
});

describe("buildRangeSeries: rango de 52 semanas superpuesto", () => {
  const week52 = { low: "235.84", high: "408.61" };
  const closes = [pt("2026-09-01", "330"), pt("2026-09-25", "345")];

  it("en 1A entran las dos líneas y la escala se estira para incluirlas", () => {
    const series = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: closes,
      week52,
    })!;
    expect(series.week52).toMatchObject({
      low: 235.84,
      high: 408.61,
      showLow: true,
      showHigh: true,
    });
    expect(plain(series.week52!.lowText)).toBe("US$ 235,84");
    expect(plain(series.week52!.highText)).toBe("US$ 408,61");
    expect(series.domain[0]).toBeLessThan(235.84);
    expect(series.domain[1]).toBeGreaterThan(408.61);
  });

  it("en 1S y 1M una línea fuera de la escala NO se dibuja y la escala no se estira", () => {
    for (const range of ["1w", "1m"] as const) {
      const series = buildRangeSeries({
        range,
        source: "intraday",
        points: closes,
        week52,
      })!;
      expect(series.week52).toMatchObject({ showLow: false, showHigh: false });
      expect(series.domain[1]).toBeLessThan(360);
    }
  });

  it("en 1S y 1M una línea cerca del precio sí entra", () => {
    const series = buildRangeSeries({
      range: "1m",
      source: "intraday",
      points: [pt("2026-09-01", "400"), pt("2026-09-25", "408")],
      week52,
    })!;
    expect(series.week52).toMatchObject({ showHigh: true, showLow: false });
  });

  it("solo entra la del lado que corresponde (mínimo cerca, máximo lejos)", () => {
    const series = buildRangeSeries({
      range: "1w",
      source: "intraday",
      points: [pt("2026-09-01", "236"), pt("2026-09-25", "240")],
      week52,
    })!;
    expect(series.week52).toMatchObject({ showLow: true, showHigh: false });
  });

  it("la etiqueta de cada línea va del lado donde la curva queda más lejos", () => {
    // Sube de 300 a 400: el máximo queda cerca del final (derecha), el mínimo cerca del principio.
    const rising = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: Array.from({ length: 30 }, (_, i) =>
        pt(`2026-09-${String(i + 1).padStart(2, "0")}`, String(300 + i * 3.5)),
      ),
      week52: { low: "290", high: "410" },
    })!;
    expect(rising.week52).toMatchObject({ highSide: "left", lowSide: "right" });
    // Baja: al revés.
    const falling = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: Array.from({ length: 30 }, (_, i) =>
        pt(`2026-09-${String(i + 1).padStart(2, "0")}`, String(400 - i * 3.5)),
      ),
      week52: { low: "290", high: "410" },
    })!;
    expect(falling.week52).toMatchObject({
      highSide: "right",
      lowSide: "left",
    });
  });

  it("en 1A la escala deja aire (10 % de la franja) para las etiquetas de afuera", () => {
    const series = buildRangeSeries({
      range: "1y",
      source: "daily",
      points: [pt("2026-09-01", "330"), pt("2026-09-25", "345")],
      week52: { low: "200", high: "400" },
    })!;
    expect(series.domain[0]).toBeCloseTo(180, 5);
    expect(series.domain[1]).toBeCloseTo(420, 5);
  });

  it("sin rango, o con uno inválido, no hay superposición", () => {
    for (const bad of [
      NO_52,
      { low: "300", high: null },
      { low: "500", high: "400" },
      { low: "0", high: "400" },
      { low: "abc", high: "400" },
      { low: "400", high: "400" },
    ]) {
      const series = buildRangeSeries({
        range: "1y",
        source: "daily",
        points: closes,
        week52: bad,
      })!;
      expect(series.week52).toBeNull();
    }
  });
});

describe("buildRangeSeries: marcas del eje", () => {
  it("1S con barras del día: una marca en la primera barra de cada rueda", () => {
    const days = [
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ];
    const series = buildRangeSeries({
      range: "1w",
      source: "intraday",
      points: bars(days),
      week52: NO_52,
    })!;
    expect(series.ticks).toEqual([
      { index: 0, text: "21/09" },
      { index: 2, text: "22/09" },
      { index: 4, text: "23/09" },
      { index: 6, text: "24/09" },
      { index: 8, text: "25/09" },
    ]);
  });

  it("1M con muchas ruedas: hasta 5 marcas repartidas, con la primera y la última rueda", () => {
    const days = Array.from(
      { length: 22 },
      (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`,
    );
    const series = buildRangeSeries({
      range: "1m",
      source: "intraday",
      points: bars(days),
      week52: NO_52,
    })!;
    expect(series.ticks).toHaveLength(5);
    expect(series.ticks[0]).toEqual({ index: 0, text: "01/09" });
    expect(series.ticks.at(-1)).toEqual({ index: 42, text: "22/09" });
    const indices = series.ticks.map((t) => t.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("1A: hasta 5 marcas con mes y año de dos cifras", () => {
    const points = Array.from({ length: 250 }, (_, i) => {
      const date = new Date(Date.UTC(2025, 8, 25 + i));
      return pt(date.toISOString().slice(0, 10), String(100 + i));
    });
    const series = buildRangeSeries({
      range: "1y",
      source: "daily",
      points,
      week52: NO_52,
    })!;
    expect(series.ticks).toHaveLength(5);
    expect(series.ticks[0]).toEqual({ index: 0, text: "09/25" });
    expect(series.ticks.every((t) => /^\d{2}\/\d{2}$/.test(t.text))).toBe(true);
  });

  it("cierres diarios en 1S o 1M (cuando falla el detalle): marcas por día, no por rueda", () => {
    const series = buildRangeSeries({
      range: "1w",
      source: "daily",
      points: ["2026-09-21", "2026-09-22", "2026-09-23"].map((day) =>
        pt(day, "100"),
      ),
      week52: NO_52,
    })!;
    expect(series.ticks.map((t) => t.text)).toEqual([
      "21/09",
      "22/09",
      "23/09",
    ]);
  });

  it("un cierre roto en el medio no corre las marcas del eje", () => {
    const series = buildRangeSeries({
      range: "1w",
      source: "daily",
      points: [
        pt("2026-09-21", "100"),
        pt("2026-09-22", "0"),
        pt("2026-09-23", "101"),
      ],
      week52: NO_52,
    })!;
    expect(series.points).toHaveLength(2);
    expect(series.ticks).toEqual([
      { index: 0, text: "21/09" },
      { index: 1, text: "23/09" },
    ]);
  });
});

describe("armado de puntos", () => {
  it("dailyInput: etiqueta con la fecha completa", () => {
    expect(dailyInput([{ date: "2026-09-25", close: "100" }])).toEqual([
      { label: "25/09/2026", day: "2026-09-25", close: "100" },
    ]);
  });

  it("intradayInput: etiqueta con la hora de Montevideo y el día de rueda de Nueva York", () => {
    // 13:30Z = 09:30 en Nueva York (apertura) = 10:30 en Montevideo.
    // 01:00Z del 26 = 21:00 del 25 en Nueva York (posmercado) = 22:00 del 25 en Montevideo.
    expect(
      intradayInput([
        { at: new Date("2026-09-25T13:30:00.000Z"), close: "100" },
        { at: new Date("2026-09-26T01:00:00.000Z"), close: "101" },
      ]),
    ).toEqual([
      { label: "25/09 10:30", day: "2026-09-25", close: "100" },
      { label: "25/09 22:00", day: "2026-09-25", close: "101" },
    ]);
  });

  it("sliceDaily: la semana son los 7 días corridos del último dato; el mes, 31", () => {
    const days = Array.from({ length: 40 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 7, 17 + i));
      return pt(date.toISOString().slice(0, 10), "100");
    });
    const week = sliceDaily("1w", days);
    expect(week[0]!.day).toBe("2026-09-19");
    expect(week.at(-1)!.day).toBe("2026-09-25");
    expect(week).toHaveLength(7);
    const month = sliceDaily("1m", days);
    expect(month).toHaveLength(31);
    expect(month.at(-1)!.day).toBe("2026-09-25");
  });

  it("sliceDaily sin datos devuelve vacío", () => {
    expect(sliceDaily("1w", [])).toEqual([]);
  });
});
