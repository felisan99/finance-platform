import { describe, expect, it } from "vitest";
import {
  MAX_POINTS,
  buildRangeSeries,
  dailyInput,
  intradayInput,
  sliceDaily,
  type RangeInputPoint,
} from "../range-chart";
import {
  DAILY_RANGES,
  DEFAULT_RANGE,
  RANGE_NAME,
  RANGE_OPTIONS,
} from "../range-options";

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

  it("en 1S, 1M y 3M una línea fuera de la escala NO se dibuja y la escala no se estira", () => {
    for (const range of ["1w", "1m", "3m"] as const) {
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

  it("en 3M una línea cerca del precio entra (como en 1S y 1M, sin estirar la escala)", () => {
    const series = buildRangeSeries({
      range: "3m",
      source: "daily",
      points: [pt("2026-07-01", "236"), pt("2026-09-25", "240")],
      week52,
    })!;
    expect(series.week52).toMatchObject({ showLow: true, showHigh: false });
    expect(series.domain[1]).toBeLessThan(250);
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

  it("3M: hasta 5 marcas con día y mes (no mes y año, como 1A)", () => {
    const points = Array.from({ length: 64 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 5, 25 + i));
      return pt(date.toISOString().slice(0, 10), String(100 + i));
    });
    const series = buildRangeSeries({
      range: "3m",
      source: "daily",
      points,
      week52: NO_52,
    })!;
    expect(series.points).toHaveLength(64);
    expect(series.ticks).toHaveLength(5);
    expect(series.ticks[0]).toEqual({ index: 0, text: "25/06" });
    expect(series.ticks.at(-1)).toEqual({ index: 63, text: "27/08" });
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

  it("sliceDaily: los 3 meses son los 92 días corridos del último dato", () => {
    const days = Array.from({ length: 200 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 2, 10 + i));
      return pt(date.toISOString().slice(0, 10), "100");
    });
    const quarter = sliceDaily("3m", days);
    expect(days.at(-1)!.day).toBe("2026-09-25");
    expect(quarter[0]!.day).toBe("2026-06-26");
    expect(quarter).toHaveLength(92);
  });

  it("sliceDaily sin datos devuelve vacío", () => {
    expect(sliceDaily("1w", [])).toEqual([]);
  });
});

describe("buildRangeSeries: densidad de puntos", () => {
  /** Barras cada `minutes` desde `from` (UTC), `perDay` por día, durante `days` días seguidos. */
  function intradayBars(
    days: number,
    perDay: number,
    minutes: number,
    from = "2026-09-21T13:30:00.000Z",
  ): RangeInputPoint[] {
    const start = new Date(from).getTime();
    return Array.from({ length: days * perDay }, (_, i) => {
      const day = Math.floor(i / perDay);
      const at = new Date(
        start + day * 86_400_000 + (i % perDay) * minutes * 60_000,
      );
      const key = at.toISOString().slice(0, 10);
      return pt(key, String(100 + i), at.toISOString());
    });
  }

  it("1S de una acción (5 ruedas de 13 barras + el cierre) queda entera", () => {
    const points = [
      ...intradayBars(5, 13, 30),
      pt("2026-09-25", "200", "2026-09-25T20:00:00.000Z"),
    ];
    const series = buildRangeSeries({
      range: "1w",
      source: "intraday",
      points,
      week52: NO_52,
    })!;
    expect(series.points).toHaveLength(66);
  });

  it("1M de una acción (21 ruedas de 7 barras) queda entera", () => {
    const series = buildRangeSeries({
      range: "1m",
      source: "intraday",
      points: intradayBars(21, 7, 60),
      week52: NO_52,
    })!;
    expect(series.points).toHaveLength(147);
  });

  it("la cripto (todo el día) se ralea a 80 puntos en 1S y 180 en 1M, con el primero y el último", () => {
    const week = intradayBars(5, 48, 30, "2026-09-21T00:00:00.000Z");
    const shortSeries = buildRangeSeries({
      range: "1w",
      source: "intraday",
      points: week,
      week52: NO_52,
    })!;
    expect(week).toHaveLength(240);
    expect(shortSeries.points).toHaveLength(MAX_POINTS["1w"]!);
    expect(shortSeries.points).toHaveLength(80);
    expect(shortSeries.points[0]!.label).toBe(week[0]!.label);
    expect(shortSeries.points.at(-1)!.label).toBe(week.at(-1)!.label);
    // El cambio del período sigue siendo del primer al último punto real.
    expect(plain(shortSeries.change!.text)).toBe("+US$ 239,00");

    const month = intradayBars(31, 24, 60, "2026-08-26T00:00:00.000Z");
    const longSeries = buildRangeSeries({
      range: "1m",
      source: "intraday",
      points: month,
      week52: NO_52,
    })!;
    expect(month).toHaveLength(744);
    expect(longSeries.points).toHaveLength(180);
    expect(longSeries.points.at(-1)!.close).toBe(843);
    // Las marcas siguen en el primer punto de cada día y en orden.
    const indices = longSeries.ticks.map((t) => t.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(longSeries.ticks.length).toBeLessThanOrEqual(5);
  });

  it("los cierres diarios (3M y 1A) no se ralean", () => {
    const points = Array.from({ length: 365 }, (_, i) => {
      const date = new Date(Date.UTC(2025, 8, 26 + i));
      return pt(date.toISOString().slice(0, 10), String(100 + i));
    });
    expect(
      buildRangeSeries({ range: "1y", source: "daily", points, week52: NO_52 })!
        .points,
    ).toHaveLength(365);
  });
});

describe("range-options", () => {
  it("cuatro rangos en orden, con 3M entre 1M y 1A", () => {
    expect(RANGE_OPTIONS.map((o) => o.text)).toEqual(["1S", "1M", "3M", "1A"]);
  });

  it("abre en 3M, que (como 1A) sale de los cierres diarios y no se pide", () => {
    expect(DEFAULT_RANGE).toBe("3m");
    expect(DAILY_RANGES).toEqual(["3m", "1y"]);
  });

  it("el cambio del período dice «En 3 meses»", () => {
    expect(RANGE_NAME["3m"]).toBe("3 meses");
    const series = buildRangeSeries({
      range: "3m",
      source: "daily",
      points: [pt("2026-07-01", "100"), pt("2026-09-25", "110")],
      week52: NO_52,
    })!;
    expect(plain(series.description)).toMatch(
      /^Gráfico del precio de 3 meses, de 2026-07-01 a 2026-09-25/,
    );
  });
});
