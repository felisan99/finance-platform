import { describe, expect, it } from "vitest";
import { d } from "@/lib/engine";
import type { InstrumentRow, QuoteRow, WatchlistMarketRow } from "../rows";
import {
  RANGE_DAYS,
  SPARK_POINTS,
  WATCHLIST_MAX,
  buildRange,
  buildWatchlistRow,
  buildWatchlistView,
  typeLabelOf,
} from "../watchlist";

const instrument = (
  symbol: string,
  over: Partial<InstrumentRow> = {},
): InstrumentRow => ({
  id: `id-${symbol}`,
  symbol,
  name: `${symbol} Inc.`,
  type: "STOCK",
  exchange: null,
  sector: null,
  provider_symbol: null,
  ...over,
});

const quote = (
  price: string,
  asOf: string,
  change: string | null = null,
): QuoteRow => ({ instrument_id: "x", price, change, as_of: asOf });

const market = (
  over: Partial<WatchlistMarketRow> = {},
): WatchlistMarketRow => ({
  instrument_id: "x",
  last_close: "108",
  last_date: "2026-09-23",
  prev_close: "107",
  prev_date: "2026-09-22",
  low_close: "90",
  high_close: "120",
  recent: null,
  ...over,
});

const row = (
  q: QuoteRow | null,
  m: WatchlistMarketRow | null,
  inst = instrument("AAA"),
) => buildWatchlistRow({ instrument: inst, quote: q, market: m });

/** Decimal → texto con 10 decimales, para comparar fracciones que no cierran (2/108). */
const t10 = (
  value: { toDecimalPlaces: (n: number) => { toFixed: () => string } } | null,
) => (value === null ? null : value.toDecimalPlaces(10).toFixed());

describe("buildWatchlistRow: precio y cambio del día", () => {
  it("cotización del día con `change` del proveedor: el cierre anterior es precio − change", () => {
    // Cotización de 110 con +2: el cierre anterior fue 108 => +2 y 2/108.
    const view = row(quote("110", "2026-09-24T19:00:00Z", "2"), market());
    expect(view.price?.toFixed()).toBe("110");
    expect(view.priceSource).toBe("quote");
    expect(view.dayChange?.toFixed()).toBe("2");
    expect(t10(view.dayChangePct)).toBe("0.0185185185");
  });

  it("una cotización más vieja que el último cierre no se usa: manda el cierre", () => {
    // Cierre 108 (23/09) contra 107 (22/09) => +1 y 1/107.
    const view = row(quote("999", "2026-09-22T20:00:00Z", "5"), market());
    expect(view.price?.toFixed()).toBe("108");
    expect(view.priceSource).toBe("close");
    expect(view.priceAsOf?.toISOString()).toBe("2026-09-23T21:00:00.000Z");
    expect(view.dayChange?.toFixed()).toBe("1");
    expect(t10(view.dayChangePct)).toBe("0.0093457944");
  });

  it("cotización del mismo día que el último cierre y sin change: el anterior es el penúltimo cierre", () => {
    const view = row(quote("109", "2026-09-23T15:00:00Z"), market());
    expect(view.priceSource).toBe("quote");
    expect(view.dayChange?.toFixed()).toBe("2"); // 109 − 107
  });

  it("cotización de un día posterior al último cierre y sin change: el anterior es el último cierre", () => {
    const view = row(quote("111", "2026-09-24T15:00:00Z"), market());
    expect(view.dayChange?.toFixed()).toBe("3"); // 111 − 108
    expect(t10(view.dayChangePct)).toBe("0.0277777778");
  });

  it("solo cotización, sin cierres: hay precio y cambio si el proveedor informó change", () => {
    const view = row(quote("50", "2026-09-24T15:00:00Z", "-1"), null);
    expect(view.price?.toFixed()).toBe("50");
    expect(view.dayChange?.toFixed()).toBe("-1");
    expect(t10(view.dayChangePct)).toBe("-0.0196078431"); // −1 / 51
    expect(view.range).toBeNull(); // sin cierres no hay rango: el precio solo es un rango plano
    expect(view.spark).toEqual([]);
  });

  it("un solo cierre y sin cotización: hay precio pero no cambio del día", () => {
    const view = row(null, market({ prev_close: null, prev_date: null }));
    expect(view.price?.toFixed()).toBe("108");
    expect(view.dayChange).toBeNull();
    expect(view.dayChangePct).toBeNull();
  });

  it("un cierre anterior de cero es un dato roto: sin cambio del día", () => {
    const view = row(quote("10", "2026-09-24T15:00:00Z", "10"), market());
    expect(view.price?.toFixed()).toBe("10");
    expect(view.dayChange).toBeNull();
    expect(view.dayChangePct).toBeNull();
  });

  it("un penúltimo cierre de cero (dato roto en la base) no da un cambio infinito", () => {
    const view = row(null, market({ prev_close: "0" }));
    expect(view.price?.toFixed()).toBe("108");
    expect(view.dayChange).toBeNull();
    expect(view.dayChangePct).toBeNull();
  });

  it("sin cotización ni cierres: todo vacío", () => {
    const view = row(null, null);
    expect(view).toMatchObject({
      price: null,
      priceSource: null,
      priceAsOf: null,
      dayChange: null,
      dayChangePct: null,
      range: null,
      spark: [],
    });
  });

  it("el cambio de un precio que baja es negativo", () => {
    const view = row(quote("100", "2026-09-24T15:00:00Z", "-8"), market());
    expect(view.dayChange?.toFixed()).toBe("-8");
    expect(t10(view.dayChangePct)).toBe("-0.0740740741"); // −8 / 108
  });
});

describe("buildRange", () => {
  it("el precio en el medio: 0,5", () => {
    const range = buildRange(d("105"), d("90"), d("120"));
    expect(range?.low.toFixed()).toBe("90");
    expect(range?.high.toFixed()).toBe("120");
    expect(range?.position).toBe(0.5);
  });

  it("en los extremos exactos: 0 y 1", () => {
    expect(buildRange(d("90"), d("90"), d("120"))?.position).toBe(0);
    expect(buildRange(d("120"), d("90"), d("120"))?.position).toBe(1);
  });

  it("un precio por encima del máximo de los cierres es el nuevo máximo (la marca no queda afuera)", () => {
    const range = buildRange(d("130"), d("90"), d("120"));
    expect(range?.high.toFixed()).toBe("130");
    expect(range?.low.toFixed()).toBe("90");
    expect(range?.position).toBe(1);
  });

  it("un precio por debajo del mínimo es el nuevo mínimo", () => {
    const range = buildRange(d("80"), d("90"), d("120"));
    expect(range?.low.toFixed()).toBe("80");
    expect(range?.high.toFixed()).toBe("120");
    expect(range?.position).toBe(0);
  });

  it("rango plano (mínimo = máximo = precio) o sin extremos: no hay barra", () => {
    expect(buildRange(d("100"), d("100"), d("100"))).toBeNull();
    expect(buildRange(d("100"), null, null)).toBeNull();
  });

  it("solo un extremo conocido: el precio completa el otro", () => {
    const range = buildRange(d("110"), d("100"), null);
    expect(range?.low.toFixed()).toBe("100");
    expect(range?.high.toFixed()).toBe("110");
    expect(range?.position).toBe(1);
  });

  it("la posición es fracción exacta de la posición del precio", () => {
    // (101 − 100) / (104 − 100) = 0,25
    expect(buildRange(d("101"), d("100"), d("104"))?.position).toBe(0.25);
  });
});

describe("buildWatchlistRow: rango y minigráfico", () => {
  it("el rango usa los extremos de los cierres y el precio actual", () => {
    const view = row(
      quote("105", "2026-09-24T15:00:00Z", "1"),
      market({ low_close: "90.5", high_close: "120.25" }),
    );
    expect(view.range?.low.toFixed()).toBe("90.5");
    expect(view.range?.high.toFixed()).toBe("120.25");
    // (105 − 90,5) / (120,25 − 90,5) = 14,5 / 29,75
    expect(view.range?.position).toBeCloseTo(14.5 / 29.75, 12);
  });

  it("minigráfico: los cierres de más viejo a más nuevo", () => {
    const view = row(
      null,
      market({
        recent: [
          ["2026-09-21", "100"],
          ["2026-09-22", "101.5"],
          ["2026-09-23", "99.25"],
        ],
      }),
    );
    expect(view.spark).toEqual([100, 101.5, 99.25]);
  });

  it("minigráfico: con menos de dos cierres válidos queda vacío", () => {
    expect(
      row(null, market({ recent: [["2026-09-23", "100"]] })).spark,
    ).toEqual([]);
    expect(row(null, market({ recent: null })).spark).toEqual([]);
    expect(
      row(
        null,
        market({
          recent: [
            ["2026-09-22", "abc"],
            ["2026-09-23", "100"],
          ],
        }),
      ).spark,
    ).toEqual([]);
  });
});

describe("buildWatchlistView", () => {
  const input = (symbol: string, type: string | null = "STOCK") => ({
    instrument: instrument(symbol, { type }),
    quote: null,
    market: null,
  });

  it("orden alfabético por símbolo, sin depender del orden de entrada", () => {
    const symbols = ["MELI", "AAPL", "BRK-B", "AA", "VOO"];
    const forward = buildWatchlistView(symbols.map((s) => input(s)));
    const backward = buildWatchlistView(
      [...symbols].reverse().map((s) => input(s)),
    );
    expect(forward.map((r) => r.symbol)).toEqual([
      "AA",
      "AAPL",
      "BRK-B",
      "MELI",
      "VOO",
    ]);
    expect(backward.map((r) => r.symbol)).toEqual(forward.map((r) => r.symbol));
  });

  it("no muta la entrada y conserva el id del instrumento", () => {
    const inputs = [input("ZZZ"), input("AAA")];
    const view = buildWatchlistView(inputs);
    expect(inputs.map((i) => i.instrument.symbol)).toEqual(["ZZZ", "AAA"]);
    expect(view[0]?.instrumentId).toBe("id-AAA");
  });

  it("lista vacía", () => {
    expect(buildWatchlistView([])).toEqual([]);
  });
});

describe("typeLabelOf y constantes", () => {
  it("ETF se llama ETF; cualquier otro tipo, Acción; sin tipo, nada", () => {
    expect(typeLabelOf("ETF")).toBe("ETF");
    expect(typeLabelOf("STOCK")).toBe("Acción");
    expect(typeLabelOf("MUTUALFUND")).toBe("Acción");
    expect(typeLabelOf(null)).toBeNull();
  });

  it("los topes que espera el trigger y la consulta", () => {
    expect(WATCHLIST_MAX).toBe(50);
    expect(SPARK_POINTS).toBe(60);
    expect(RANGE_DAYS).toBe(365);
  });
});
