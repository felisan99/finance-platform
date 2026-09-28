import { describe, expect, it } from "vitest";
import { d, type DailyClose } from "@/lib/engine";
import {
  applyLiveQuotes,
  liveDay,
  liveQuoteOf,
  withLiveBar,
  type LiveQuote,
} from "../live-series";
import { sparkOf } from "../watchlist";

const closes = (rows: ReadonlyArray<readonly [string, string]>): DailyClose[] =>
  rows.map(([date, close]) => ({ date, close: d(close) }));
const quote = (price: string, asOf: string): LiveQuote => ({
  price: d(price),
  asOf: new Date(asOf),
});
const shown = (list: readonly DailyClose[]) =>
  list.map((c) => [c.date, c.close.toFixed()]);

// Jueves 24/09 de 2026 = último cierre; la cotización de hoy es del viernes 25/09 a media rueda.
const LAST = "2026-09-24";
const FRIDAY_LIVE = "2026-09-25T17:30:00Z";

describe("liveDay", () => {
  it("una cotización de un día posterior al último cierre suma un punto en ese día", () => {
    expect(liveDay(LAST, quote("100", FRIDAY_LIVE))).toBe("2026-09-25");
  });

  it("del mismo día que el último cierre (o anterior): gana el cierre", () => {
    expect(liveDay(LAST, quote("100", "2026-09-24T20:00:00Z"))).toBeNull();
    expect(liveDay(LAST, quote("100", "2026-09-23T20:00:00Z"))).toBeNull();
  });

  it("sin ningún cierre no hay punto: el valor saltaría de costo a mercado en un día", () => {
    expect(liveDay(null, quote("100", FRIDAY_LIVE))).toBeNull();
  });

  it("sin cotización no hay punto", () => {
    expect(liveDay(LAST, null)).toBeNull();
  });

  it("el día es el de Nueva York: las 21:30 del viernes en Nueva York ya son sábado en UTC", () => {
    expect(liveDay(LAST, quote("100", "2026-09-26T01:30:00Z"))).toBe(
      "2026-09-25",
    );
  });

  it("precio cero o negativo y fechas inválidas son datos rotos: sin punto", () => {
    expect(liveDay(LAST, quote("0", FRIDAY_LIVE))).toBeNull();
    expect(liveDay(LAST, quote("-5", FRIDAY_LIVE))).toBeNull();
    expect(liveDay(LAST, quote("100", "no es una fecha"))).toBeNull();
  });
});

describe("liveQuoteOf", () => {
  const at = new Date(FRIDAY_LIVE);
  it("solo la cotización cuenta como en vivo", () => {
    expect(liveQuoteOf({ price: d("5"), asOf: at, source: "quote" })).toEqual({
      price: d("5"),
      asOf: at,
    });
    expect(
      liveQuoteOf({ price: d("5"), asOf: at, source: "close" }),
    ).toBeNull();
  });

  it("sin precio, sin fecha o sin nada: no hay cotización", () => {
    expect(liveQuoteOf({ price: null, asOf: at, source: "quote" })).toBeNull();
    expect(
      liveQuoteOf({ price: d("5"), asOf: null, source: "quote" }),
    ).toBeNull();
    expect(liveQuoteOf(null)).toBeNull();
  });
});

describe("applyLiveQuotes", () => {
  const voo = closes([
    ["2026-09-23", "100"],
    [LAST, "101"],
  ]);
  const aapl = closes([
    ["2026-09-23", "200"],
    [LAST, "202"],
  ]);
  const spy = closes([
    ["2026-09-23", "500"],
    [LAST, "505"],
  ]);
  const held = new Map([
    ["VOO", voo],
    ["AAPL", aapl],
  ]);

  it("suma la cotización de hoy al final de cada serie, incluido el benchmark", () => {
    const live = applyLiveQuotes({
      closes: held,
      quotes: new Map([
        ["VOO", quote("103", FRIDAY_LIVE)],
        ["AAPL", quote("204", FRIDAY_LIVE)],
      ]),
      benchmark: spy,
      benchmarkQuote: quote("510", FRIDAY_LIVE),
    });
    expect(shown(live.closes.get("VOO")!)).toEqual([
      ["2026-09-23", "100"],
      [LAST, "101"],
      ["2026-09-25", "103"],
    ]);
    expect(shown(live.closes.get("AAPL")!).at(-1)).toEqual([
      "2026-09-25",
      "204",
    ]);
    expect(shown(live.benchmark).at(-1)).toEqual(["2026-09-25", "510"]);
  });

  it("informa el instante más viejo de las cotizaciones que entraron", () => {
    const live = applyLiveQuotes({
      closes: held,
      quotes: new Map([
        ["VOO", quote("103", "2026-09-25T17:30:00Z")],
        ["AAPL", quote("204", "2026-09-25T15:10:00Z")],
      ]),
      benchmark: spy,
      benchmarkQuote: quote("510", "2026-09-25T16:00:00Z"),
    });
    expect(live.liveAsOf?.toISOString()).toBe("2026-09-25T15:10:00.000Z");
  });

  it("el benchmark también cuenta para el instante más viejo", () => {
    const live = applyLiveQuotes({
      closes: held,
      quotes: new Map([["VOO", quote("103", "2026-09-25T17:30:00Z")]]),
      benchmark: spy,
      benchmarkQuote: quote("510", "2026-09-25T14:45:00Z"),
    });
    expect(live.liveAsOf?.toISOString()).toBe("2026-09-25T14:45:00.000Z");
  });

  it("sin ninguna cotización más nueva que los cierres no cambia nada, con o sin benchmark", () => {
    for (const benchmark of [spy, []]) {
      const live = applyLiveQuotes({
        closes: held,
        quotes: new Map([
          ["VOO", quote("101", "2026-09-24T20:00:00Z")],
          ["AAPL", quote("202", "2026-09-23T20:00:00Z")],
        ]),
        benchmark,
        benchmarkQuote: null,
      });
      expect(live.liveAsOf).toBeNull();
      expect(live.closes.get("VOO")).toEqual(voo);
      expect(live.benchmark).toEqual(benchmark);
    }
  });

  it("un símbolo con cotización vieja sigue con su cierre y los demás suman su punto", () => {
    const live = applyLiveQuotes({
      closes: held,
      quotes: new Map([
        ["VOO", quote("103", FRIDAY_LIVE)],
        ["AAPL", quote("203", "2026-09-24T20:00:00Z")],
      ]),
      benchmark: spy,
      benchmarkQuote: quote("510", FRIDAY_LIVE),
    });
    expect(live.closes.get("AAPL")).toEqual(aapl);
    expect(live.closes.get("VOO")).toHaveLength(3);
    // Solo entra lo que suma un punto: el instante de la cotización vieja no cuenta.
    expect(live.liveAsOf?.toISOString()).toBe("2026-09-25T17:30:00.000Z");
  });

  it("el día en vivo del portafolio es el más nuevo de sus posiciones: el benchmark tiene que llegar a ese", () => {
    const input = (benchmarkQuote: LiveQuote) => ({
      closes: held,
      quotes: new Map([
        ["VOO", quote("103", FRIDAY_LIVE)],
        ["AAPL", quote("204", "2026-09-28T17:00:00Z")],
      ]),
      benchmark: spy,
      benchmarkQuote,
    });
    const aligned = applyLiveQuotes(
      input(quote("510", "2026-09-28T17:05:00Z")),
    );
    expect(aligned.liveAsOf).not.toBeNull();
    expect(aligned.closes.get("AAPL")).toHaveLength(3);
    // Un benchmark que solo llega al día de la posición más vieja no alcanza.
    expect(
      applyLiveQuotes(input(quote("510", FRIDAY_LIVE))).liveAsOf,
    ).toBeNull();
  });

  it("si el benchmark no llega al mismo día en vivo, nadie suma punto (portafolio y benchmark terminan el mismo día)", () => {
    for (const benchmarkQuote of [
      null,
      quote("510", "2026-09-24T20:00:00Z"), // cotización que no es más nueva que su cierre
      quote("510", "2026-09-28T17:00:00Z"), // de otro día que las posiciones
    ]) {
      const live = applyLiveQuotes({
        closes: held,
        quotes: new Map([["VOO", quote("103", FRIDAY_LIVE)]]),
        benchmark: spy,
        benchmarkQuote,
      });
      expect(live.liveAsOf).toBeNull();
      expect(live.closes.get("VOO")).toEqual(voo);
      expect(live.benchmark).toEqual(spy);
    }
  });

  it("un fin de semana (solo se mueve la cripto) el benchmark de acciones queda con su cierre y la cripto suma su punto", () => {
    const btc = closes([
      ["2026-09-25", "80000"],
      ["2026-09-26", "81000"],
    ]);
    const friday = closes([
      ["2026-09-24", "500"],
      ["2026-09-25", "505"],
    ]);
    const live = applyLiveQuotes({
      closes: new Map([["BTC-USD", btc]]),
      quotes: new Map([["BTC-USD", quote("82000", "2026-09-27T15:00:00Z")]]),
      benchmark: friday,
      // La última cotización de SPY es la del viernes: no es más nueva que su cierre.
      benchmarkQuote: quote("505", "2026-09-25T20:00:00Z"),
    });
    expect(live.closes.get("BTC-USD")?.at(-1)).toEqual({
      date: "2026-09-27",
      close: d("82000"),
    });
    expect(live.benchmark).toEqual(friday);
    expect(live.liveAsOf?.toISOString()).toBe("2026-09-27T15:00:00.000Z");
  });

  it("un fin de semana con benchmark cripto en vivo, el benchmark también suma su punto", () => {
    const btc = closes([["2026-09-26", "81000"]]);
    const live = applyLiveQuotes({
      closes: new Map([["ETH-USD", closes([["2026-09-26", "2500"]])]]),
      quotes: new Map([["ETH-USD", quote("2600", "2026-09-27T15:00:00Z")]]),
      benchmark: btc,
      benchmarkQuote: quote("82000", "2026-09-27T15:05:00Z"),
    });
    expect(live.benchmark.at(-1)?.date).toBe("2026-09-27");
    expect(live.liveAsOf?.toISOString()).toBe("2026-09-27T15:00:00.000Z");
  });

  it("si el benchmark está en vivo pero ninguna posición, tampoco suma punto", () => {
    const live = applyLiveQuotes({
      closes: held,
      quotes: new Map(),
      benchmark: spy,
      benchmarkQuote: quote("510", FRIDAY_LIVE),
    });
    expect(live.liveAsOf).toBeNull();
    expect(live.benchmark).toEqual(spy);
  });

  it("sin datos de benchmark las posiciones suman su punto igual", () => {
    const live = applyLiveQuotes({
      closes: held,
      quotes: new Map([["VOO", quote("103", FRIDAY_LIVE)]]),
      benchmark: [],
      benchmarkQuote: null,
    });
    expect(live.closes.get("VOO")).toHaveLength(3);
    expect(live.benchmark).toEqual([]);
    expect(live.liveAsOf?.toISOString()).toBe("2026-09-25T17:30:00.000Z");
  });

  it("un símbolo sin ningún cierre no suma punto y una cotización de un símbolo que no está en las series se ignora", () => {
    const live = applyLiveQuotes({
      closes: new Map([...held, ["NEW", []]]),
      quotes: new Map([
        ["NEW", quote("50", FRIDAY_LIVE)],
        ["OTRO", quote("9", FRIDAY_LIVE)],
        ["VOO", quote("103", FRIDAY_LIVE)],
      ]),
      benchmark: [],
      benchmarkQuote: null,
    });
    expect(live.closes.get("NEW")).toEqual([]);
    expect(live.closes.has("OTRO")).toBe(false);
  });

  it("no modifica lo que recibe", () => {
    const input = {
      closes: held,
      quotes: new Map([["VOO", quote("103", FRIDAY_LIVE)]]),
      benchmark: spy,
      benchmarkQuote: quote("510", FRIDAY_LIVE),
    };
    applyLiveQuotes(input);
    expect(voo).toHaveLength(2);
    expect(spy).toHaveLength(2);
  });
});

describe("withLiveBar", () => {
  const series = [
    { date: "2026-09-23", close: "100" },
    { date: LAST, close: "101" },
  ];
  const price = (source: "quote" | "close", asOf = FRIDAY_LIVE) => ({
    price: d("103.5"),
    asOf: new Date(asOf),
    source,
  });

  it("agrega la cotización de hoy como texto al final", () => {
    expect(withLiveBar(series, price("quote"))).toEqual([
      ...series,
      { date: "2026-09-25", close: "103.5" },
    ]);
  });

  it("no agrega nada si el precio es un cierre, no es más nuevo o no hay", () => {
    expect(withLiveBar(series, price("close"))).toEqual(series);
    expect(withLiveBar(series, price("quote", "2026-09-24T20:00:00Z"))).toEqual(
      series,
    );
    expect(withLiveBar(series, null)).toEqual(series);
    expect(withLiveBar([], price("quote"))).toEqual([]);
  });
});

describe("sparkOf con la cotización de hoy", () => {
  const market = {
    last_date: LAST,
    recent: [
      ["2026-09-22", "99"],
      ["2026-09-23", "100"],
      [LAST, "101"],
    ] as Array<[string, string]>,
  };
  const price = (source: "quote" | "close", asOf = FRIDAY_LIVE) => ({
    price: d("103.5"),
    asOf: new Date(asOf),
    source,
  });

  it("termina en la cotización mientras no haya cierre de hoy", () => {
    expect(sparkOf(market, price("quote"))).toEqual([99, 100, 101, 103.5]);
  });

  it("sin cotización en vivo son solo los cierres, como siempre", () => {
    expect(sparkOf(market)).toEqual([99, 100, 101]);
    expect(sparkOf(market, price("close"))).toEqual([99, 100, 101]);
    expect(sparkOf(market, price("quote", "2026-09-24T20:00:00Z"))).toEqual([
      99, 100, 101,
    ]);
  });

  it("con un solo cierre y la cotización de hoy ya hay línea para dibujar", () => {
    const one = {
      last_date: LAST,
      recent: [[LAST, "101"]] as Array<[string, string]>,
    };
    expect(sparkOf(one, price("quote"))).toEqual([101, 103.5]);
    expect(sparkOf(one)).toEqual([]);
  });

  it("sin filas de mercado no hay minigráfico", () => {
    expect(sparkOf(null, price("quote"))).toEqual([]);
  });
});
