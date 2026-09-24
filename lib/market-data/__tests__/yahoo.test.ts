import { describe, expect, it, vi } from "vitest";
import { MarketDataError } from "../errors";
import { createYahooProvider } from "../yahoo";
import {
  NY,
  bar,
  chartResponse,
  fakeClient,
  fastOptions,
  httpError,
  quoteItem,
} from "./helpers";

const FROM = new Date("2026-09-01T00:00:00.000Z");
const TO = new Date("2026-09-24T00:00:00.000Z");
// Después del cierre de NY del 2026-09-23 (20:00Z): la rueda de ese día ya es definitiva.
const AFTER_CLOSE = () => new Date("2026-09-23T23:37:00.000Z");

function providerFor(chart: unknown, now: () => Date = AFTER_CLOSE) {
  const { client, calls } = fakeClient({ chart: async () => chart });
  return {
    provider: createYahooProvider(client, { ...fastOptions, now }),
    calls,
  };
}

describe("getDailyHistory: precios", () => {
  it("redondea el ruido de float32 a los decimales del priceHint", async () => {
    const { provider } = providerFor(
      chartResponse({
        quotes: [
          bar("2026-06-01T13:30:00.000Z", 1730.97998046875),
          bar("2026-09-21T13:30:00.000Z", 712.780029296875, 700.1234567),
        ],
      }),
    );
    const { bars } = await provider.getDailyHistory("MELI", FROM, TO);
    expect(bars).toEqual([
      { date: "2026-06-01", close: "1730.98", adjClose: "1730.98" },
      { date: "2026-09-21", close: "712.78", adjClose: "700.12" },
    ]);
  });

  it("sin priceHint usa 2 decimales desde 1 USD y 4 por debajo", async () => {
    const { provider } = providerFor(
      chartResponse({
        priceHint: null,
        quotes: [
          bar("2026-09-21T13:30:00.000Z", 29.650000095367432),
          bar("2026-09-22T13:30:00.000Z", 0.51234567),
        ],
      }),
    );
    const { bars } = await provider.getDailyHistory("FSLY", FROM, TO);
    expect(bars.map((b) => b.close)).toEqual(["29.65", "0.5123"]);
  });

  it("acota el priceHint entre 2 y 6 decimales", async () => {
    const { provider } = providerFor(
      chartResponse({
        priceHint: 9,
        quotes: [bar("2026-09-21T13:30:00.000Z", 1.23456789)],
      }),
    );
    const { bars } = await provider.getDailyHistory("X", FROM, TO);
    expect(bars[0]?.close).toBe("1.234568");
  });

  it("descarta y cuenta las barras sin cierre válido (Yahoo devuelve null algunos días)", async () => {
    const { provider } = providerFor(
      chartResponse({
        quotes: [
          bar("2026-09-21T13:30:00.000Z", 712.780029296875),
          bar("2026-09-22T13:30:00.000Z", null),
          bar("2026-09-23T13:30:00.000Z", 707.5999755859375),
          bar("2026-09-18T13:30:00.000Z", 0),
          bar("2026-09-17T13:30:00.000Z", -5),
        ],
      }),
    );
    const { bars, droppedBars } = await provider.getDailyHistory(
      "VOO",
      FROM,
      TO,
    );
    expect(bars.map((b) => b.date)).toEqual(["2026-09-21", "2026-09-23"]);
    expect(droppedBars).toBe(3);
  });

  it("deja adjClose en null si el ajustado viene nulo o inválido", async () => {
    const { provider } = providerFor(
      chartResponse({
        quotes: [
          bar("2026-09-21T13:30:00.000Z", 10, null),
          bar("2026-09-22T13:30:00.000Z", 11, 0),
        ],
      }),
    );
    const { bars } = await provider.getDailyHistory("X", FROM, TO);
    expect(bars.map((b) => b.adjClose)).toEqual([null, null]);
  });

  it("ordena por fecha y deduplica (gana la última)", async () => {
    const { provider } = providerFor(
      chartResponse({
        quotes: [
          bar("2026-09-22T13:30:00.000Z", 12),
          bar("2026-09-21T13:30:00.000Z", 11),
          bar("2026-09-22T14:30:00.000Z", 13),
        ],
      }),
    );
    const { bars } = await provider.getDailyHistory("X", FROM, TO);
    expect(bars).toEqual([
      { date: "2026-09-21", close: "11", adjClose: "11" },
      { date: "2026-09-22", close: "13", adjClose: "13" },
    ]);
  });

  it("una ventana sin ruedas (fin de semana) devuelve vacío, no error", async () => {
    const { provider } = providerFor(chartResponse({ quotes: [] }));
    await expect(provider.getDailyHistory("VOO", FROM, TO)).resolves.toEqual({
      bars: [],
      actions: [],
      droppedBars: 0,
    });
  });

  it("pasa la ventana y pide eventos de dividendos y splits", async () => {
    const { provider, calls } = providerFor(chartResponse());
    await provider.getDailyHistory("BRK-B", FROM, TO);
    expect(calls.chart).toEqual([
      [
        "BRK-B",
        { period1: FROM, period2: TO, interval: "1d", events: "div|split" },
      ],
    ]);
  });
});

describe("getDailyHistory: fechas y rueda abierta", () => {
  it("la fecha es la de la zona horaria de la bolsa, no la UTC", async () => {
    // 23:30Z ya es el día siguiente en Tokio (08:30 JST) pero seguiría siendo el mismo día en UTC.
    const tokyo = providerFor(
      chartResponse({
        timeZone: "Asia/Tokyo",
        regular: null,
        quotes: [bar("2026-06-01T23:30:00.000Z", 100)],
      }),
    );
    expect(
      (await tokyo.provider.getDailyHistory("X", FROM, TO)).bars[0]?.date,
    ).toBe("2026-06-02");

    // 02:00Z del 2 de junio sigue siendo el 1 de junio a las 22:00 en Nueva York.
    const ny = providerFor(
      chartResponse({
        regular: null,
        quotes: [bar("2026-06-02T02:00:00.000Z", 100)],
      }),
    );
    expect(
      (await ny.provider.getDailyHistory("X", FROM, TO)).bars[0]?.date,
    ).toBe("2026-06-01");
  });

  const partialDay = () =>
    chartResponse({
      quotes: [
        bar("2026-09-22T13:30:00.000Z", 712.78),
        bar("2026-09-23T13:30:00.000Z", 707.6),
      ],
    });

  it("no guarda el 'cierre' parcial mientras la rueda de hoy está abierta", async () => {
    const midSession = () => new Date("2026-09-23T15:00:00.000Z");
    const { provider } = providerFor(partialDay(), midSession);
    const { bars, droppedBars } = await provider.getDailyHistory(
      "VOO",
      FROM,
      TO,
    );
    expect(bars.map((b) => b.date)).toEqual(["2026-09-22"]);
    // Excluir la barra parcial no es un dato malo: no cuenta como descartada.
    expect(droppedBars).toBe(0);
  });

  it("guarda la barra de hoy una vez cerrada la rueda", async () => {
    const { provider } = providerFor(partialDay(), AFTER_CLOSE);
    const { bars } = await provider.getDailyHistory("VOO", FROM, TO);
    expect(bars.map((b) => b.date)).toEqual(["2026-09-22", "2026-09-23"]);
  });

  it("antes de la apertura no excluye nada", async () => {
    const preMarket = () => new Date("2026-09-23T12:00:00.000Z");
    const { provider } = providerFor(partialDay(), preMarket);
    const { bars } = await provider.getDailyHistory("VOO", FROM, TO);
    expect(bars).toHaveLength(2);
  });

  it("sin currentTradingPeriod no excluye nada", async () => {
    const { provider } = providerFor(
      chartResponse({
        regular: null,
        quotes: [bar("2026-09-23T13:30:00.000Z", 707.6)],
      }),
      () => new Date("2026-09-23T15:00:00.000Z"),
    );
    expect((await provider.getDailyHistory("VOO", FROM, TO)).bars).toHaveLength(
      1,
    );
  });
});

describe("getDailyHistory: splits y dividendos", () => {
  const at = (iso: string) => new Date(iso);

  it("convierte el split 10:1 de NVDA en ratio 10, con la fecha ex de la rueda", async () => {
    const { provider } = providerFor(
      chartResponse({
        regular: null,
        quotes: [
          bar(
            "2024-06-05T13:30:00.000Z",
            122.44000244140625,
            122.09187316894531,
          ),
        ],
        events: {
          dividends: [{ date: at("2024-06-11T13:30:00.000Z"), amount: 0.01 }],
          splits: [
            {
              date: at("2024-06-10T13:30:00.000Z"),
              numerator: 10,
              denominator: 1,
              splitRatio: "10:1",
            },
          ],
        },
      }),
    );
    const { actions } = await provider.getDailyHistory("NVDA", FROM, TO);
    expect(actions).toEqual([
      { type: "SPLIT", exDate: "2024-06-10", ratio: "10" },
      { type: "DIVIDEND", exDate: "2024-06-11", amount: "0.01" },
    ]);
  });

  it.each([
    { numerator: 3, denominator: 2, ratio: "1.5" },
    { numerator: 1, denominator: 10, ratio: "0.1" },
    { numerator: 1, denominator: 3, ratio: "0.33333333" },
    { numerator: 2, denominator: 1, ratio: "2" },
  ])(
    "ratio de $numerator:$denominator = $ratio (numeric(20,8))",
    async ({ numerator, denominator, ratio }) => {
      const { provider } = providerFor(
        chartResponse({
          regular: null,
          events: {
            splits: [
              { date: at("2026-03-02T14:30:00.000Z"), numerator, denominator },
            ],
          },
        }),
      );
      const { actions } = await provider.getDailyHistory("X", FROM, TO);
      expect(actions).toEqual([{ type: "SPLIT", exDate: "2026-03-02", ratio }]);
    },
  );

  it("redondea el importe del dividendo a 6 decimales y quita el ruido float", async () => {
    const { provider } = providerFor(
      chartResponse({
        regular: null,
        events: {
          dividends: [
            { date: at("2026-03-27T13:30:00.000Z"), amount: 1.872 },
            {
              date: at("2026-06-26T13:30:00.000Z"),
              amount: 0.30000001192092896,
            },
          ],
        },
      }),
    );
    const { actions } = await provider.getDailyHistory("VOO", FROM, TO);
    expect(actions).toEqual([
      { type: "DIVIDEND", exDate: "2026-03-27", amount: "1.872" },
      { type: "DIVIDEND", exDate: "2026-06-26", amount: "0.3" },
    ]);
  });

  it("ignora eventos inválidos (ratio o importe no positivo) y deduplica", async () => {
    const { provider } = providerFor(
      chartResponse({
        regular: null,
        events: {
          splits: [
            {
              date: at("2026-03-02T14:30:00.000Z"),
              numerator: 2,
              denominator: 0,
            },
            {
              date: at("2026-03-03T14:30:00.000Z"),
              numerator: 0,
              denominator: 1,
            },
          ],
          dividends: [
            { date: at("2026-03-27T13:30:00.000Z"), amount: 0 },
            { date: at("2026-03-28T13:30:00.000Z"), amount: -1 },
            { date: at("2026-03-29T13:30:00.000Z"), amount: 0.0000001 },
            { date: at("2026-04-01T13:30:00.000Z"), amount: 0.5 },
            { date: at("2026-04-01T14:30:00.000Z"), amount: 0.5 },
          ],
        },
      }),
    );
    const { actions } = await provider.getDailyHistory("X", FROM, TO);
    expect(actions).toEqual([
      { type: "DIVIDEND", exDate: "2026-04-01", amount: "0.5" },
    ]);
  });
});

describe("getDailyHistory: entradas y respuestas inválidas", () => {
  it.each(["", "voo", "A B", "VOO;DROP", "A".repeat(20), "../etc", "VOO\n"])(
    "rechaza el símbolo %j sin llamar al proveedor",
    async (symbol) => {
      const { provider, calls } = providerFor(chartResponse());
      await expect(
        provider.getDailyHistory(symbol, FROM, TO),
      ).rejects.toMatchObject({
        kind: "BAD_REQUEST",
      });
      expect(calls.chart).toHaveLength(0);
    },
  );

  it.each([
    ["desde igual a hasta", FROM, FROM],
    ["desde posterior a hasta", TO, FROM],
    ["fecha inválida", new Date("nope"), TO],
  ])("rechaza una ventana inválida: %s", async (_label, from, to) => {
    const { provider, calls } = providerFor(chartResponse());
    await expect(
      provider.getDailyHistory("VOO", from, to),
    ).rejects.toMatchObject({
      kind: "BAD_REQUEST",
    });
    expect(calls.chart).toHaveLength(0);
  });

  it.each([
    ["sin meta", { quotes: [] }],
    [
      "quotes no es un arreglo",
      { meta: { exchangeTimezoneName: NY }, quotes: "x" },
    ],
    [
      "fecha de barra inválida",
      chartResponse({
        quotes: [
          { ...bar("2026-09-21T13:30:00.000Z", 1), date: new Date("nope") },
        ],
      }),
    ],
    ["null", null],
    ["un string", "<html>blocked</html>"],
  ])(
    "BAD_DATA si la respuesta no tiene el formato esperado: %s",
    async (_label, response) => {
      const { provider } = providerFor(response);
      await expect(
        provider.getDailyHistory("VOO", FROM, TO),
      ).rejects.toMatchObject({
        kind: "BAD_DATA",
      });
    },
  );

  it("BAD_DATA si la zona horaria no existe", async () => {
    const { provider } = providerFor(
      chartResponse({
        timeZone: "Marte/Olympus",
        quotes: [bar("2026-09-21T13:30:00.000Z", 1)],
      }),
    );
    await expect(
      provider.getDailyHistory("VOO", FROM, TO),
    ).rejects.toMatchObject({
      kind: "BAD_DATA",
    });
  });

  it("el mensaje de BAD_DATA dice qué campo falló pero no vuelca la respuesta", async () => {
    const { provider } = providerFor({
      meta: { exchangeTimezoneName: 5 },
      quotes: [],
      secreto: "no-debe-salir",
    });
    const error = await provider
      .getDailyHistory("VOO", FROM, TO)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MarketDataError);
    expect((error as MarketDataError).message).toMatch(
      /meta\.exchangeTimezoneName/,
    );
    expect((error as MarketDataError).message).not.toMatch(/no-debe-salir/);
    expect((error as MarketDataError).symbol).toBe("VOO");
  });
});

describe("errores del proveedor", () => {
  const history = (client: ReturnType<typeof fakeClient>["client"]) =>
    createYahooProvider(client, {
      ...fastOptions,
      now: AFTER_CLOSE,
    }).getDailyHistory("ZZZZ", FROM, TO);

  it("símbolo desconocido: NOT_FOUND, sin reintentos", async () => {
    const { client, calls } = fakeClient({
      chart: async () => {
        throw new Error("No data found, symbol may be delisted");
      },
    });
    await expect(history(client)).rejects.toMatchObject({
      kind: "NOT_FOUND",
      symbol: "ZZZZ",
    });
    expect(calls.chart).toHaveLength(1);
  });

  it("429 seguido de éxito: reintenta y termina bien", async () => {
    let attempt = 0;
    const sleep = vi.fn(async () => {});
    const { client, calls } = fakeClient({
      chart: async () => {
        attempt++;
        if (attempt === 1) throw httpError(429, "Too Many Requests");
        return chartResponse({ quotes: [bar("2026-09-21T13:30:00.000Z", 10)] });
      },
    });
    const provider = createYahooProvider(client, {
      ...fastOptions,
      sleep,
      now: AFTER_CLOSE,
    });
    const { bars } = await provider.getDailyHistory("VOO", FROM, TO);
    expect(bars).toHaveLength(1);
    expect(calls.chart).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("500 persistente: UNAVAILABLE después de 4 intentos (1 + 3 reintentos)", async () => {
    const { client, calls } = fakeClient({
      chart: async () => {
        throw httpError(503, "<html>service unavailable</html>");
      },
    });
    await expect(history(client)).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      symbol: "ZZZZ",
    });
    expect(calls.chart).toHaveLength(4);
  });

  it("un fallo de red también se reintenta", async () => {
    const { client, calls } = fakeClient({
      chart: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(history(client)).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
    expect(calls.chart).toHaveLength(4);
  });

  it("la validación de la librería (FailedYahooValidationError) es BAD_DATA y no se reintenta", async () => {
    const { client, calls } = fakeClient({
      chart: async () => {
        const error = new Error("Failed Yahoo Schema validation");
        error.name = "FailedYahooValidationError";
        throw error;
      },
    });
    await expect(history(client)).rejects.toMatchObject({ kind: "BAD_DATA" });
    expect(calls.chart).toHaveLength(1);
  });

  it("el mensaje de error no filtra el cuerpo HTTP de la respuesta", async () => {
    const { client } = fakeClient({
      chart: async () => {
        throw httpError(500, "<html>token=abc123 crumb=zzz</html>");
      },
    });
    const error = (await history(client).catch(
      (e: unknown) => e,
    )) as MarketDataError;
    expect(error.message).toBe("proveedor no disponible (HTTP 500)");
  });
});

describe("getQuotes", () => {
  const providerWith = (quote: (symbols: string[]) => Promise<unknown>) => {
    const { client, calls } = fakeClient({ quote });
    return {
      provider: createYahooProvider(client, {
        ...fastOptions,
        now: AFTER_CLOSE,
      }),
      calls,
    };
  };

  it("convierte la cotización: precio y cambio redondeados, variación como fracción", async () => {
    const { provider } = providerWith(async () => [quoteItem()]);
    expect(await provider.getQuotes(["VOO"])).toEqual([
      {
        symbol: "VOO",
        price: "707.6",
        change: "-5.18",
        changePct: "-0.007267",
        asOf: new Date("2026-09-23T20:00:00.000Z"),
        currency: "USD",
      },
    ]);
  });

  it("omite los símbolos que Yahoo no devuelve (desconocidos)", async () => {
    const { provider } = providerWith(async () => [
      quoteItem({ symbol: "VOO" }),
      quoteItem({ symbol: "KOS", regularMarketPrice: 2.6500000953674316 }),
      quoteItem({ symbol: "FSLY", regularMarketPrice: 29.65 }),
    ]);
    const quotes = await provider.getQuotes(["VOO", "KOS", "FSLY", "ZZZZQ9"]);
    expect(quotes.map((q) => q.symbol)).toEqual(["VOO", "KOS", "FSLY"]);
    expect(quotes[1]?.price).toBe("2.65");
  });

  it("un elemento inválido no tira abajo al resto", async () => {
    const { provider } = providerWith(async () => [
      quoteItem({ symbol: "AAA", regularMarketPrice: 0 }),
      quoteItem({ symbol: "BBB", regularMarketTime: "ayer" }),
      quoteItem({ symbol: "CCC", regularMarketPrice: Number.NaN }),
      null,
      quoteItem({ symbol: "DDD" }),
    ]);
    const quotes = await provider.getQuotes(["AAA", "BBB", "CCC", "DDD"]);
    expect(quotes.map((q) => q.symbol)).toEqual(["DDD"]);
  });

  it("cambio y variación ausentes quedan en null", async () => {
    const { provider } = providerWith(async () => [
      quoteItem({
        regularMarketChange: undefined,
        regularMarketChangePercent: null,
      }),
    ]);
    const [quote] = await provider.getQuotes(["VOO"]);
    expect(quote?.change).toBeNull();
    expect(quote?.changePct).toBeNull();
  });

  it("agrupa de a 50 símbolos y quita repetidos", async () => {
    const symbols = Array.from({ length: 120 }, (_, i) => `S${i}`);
    const { provider, calls } = providerWith(async () => []);
    await provider.getQuotes([...symbols, "S0", "S1"]);
    expect(calls.quote.map(([chunk]) => (chunk as string[]).length)).toEqual([
      50, 50, 20,
    ]);
  });

  it("sin símbolos no consulta", async () => {
    const { provider, calls } = providerWith(async () => []);
    expect(await provider.getQuotes([])).toEqual([]);
    expect(calls.quote).toHaveLength(0);
  });

  it("rechaza un símbolo inválido antes de consultar", async () => {
    const { provider, calls } = providerWith(async () => []);
    await expect(provider.getQuotes(["VOO", "a b"])).rejects.toMatchObject({
      kind: "BAD_REQUEST",
    });
    expect(calls.quote).toHaveLength(0);
  });

  it("BAD_DATA si la respuesta no es un arreglo", async () => {
    const { provider } = providerWith(async () => ({ symbol: "VOO" }));
    await expect(provider.getQuotes(["VOO"])).rejects.toMatchObject({
      kind: "BAD_DATA",
    });
  });

  it("sin priceHint, un precio menor a 1 USD lleva 4 decimales", async () => {
    const { provider } = providerWith(async () => [
      quoteItem({
        symbol: "PENNY",
        regularMarketPrice: 0.51234567,
        regularMarketChange: 0.00123456,
      }),
    ]);
    const [quote] = await provider.getQuotes(["PENNY"]);
    expect(quote?.price).toBe("0.5123");
    expect(quote?.change).toBe("0.0012");
  });

  it("un cambio que redondea a cero no queda como '-0'", async () => {
    const { provider } = providerWith(async () => [
      quoteItem({ regularMarketChange: -0.0001 }),
    ]);
    const [quote] = await provider.getQuotes(["VOO"]);
    expect(quote?.change).toBe("0");
  });
});

describe("search", () => {
  const item = (overrides: Record<string, unknown>) => ({
    symbol: "VOO",
    quoteType: "ETF",
    exchange: "PCX",
    longname: "Vanguard S&P 500 ETF",
    shortname: "VANGUARD S&P 500 ETF",
    isYahooFinance: true,
    ...overrides,
  });

  const providerWith = (quotes: unknown[]) => {
    const { client, calls } = fakeClient({
      search: async () => ({ quotes, news: [] }),
    });
    return { provider: createYahooProvider(client, fastOptions), calls };
  };

  it("deja solo acciones y ETFs de bolsas de EE.UU. con símbolos que la base acepta", async () => {
    const { provider } = providerWith([
      item({ symbol: "VOO" }),
      item({
        symbol: "MELI",
        quoteType: "EQUITY",
        exchange: "NMS",
        longname: "MercadoLibre, Inc.",
      }),
      item({ symbol: "SOXX", exchange: "NGM" }),
      item({ symbol: "BRK-B", quoteType: "EQUITY", exchange: "NYQ" }),
      item({ symbol: "SPYI", exchange: "BTS" }),
      item({ symbol: "VFV.TO", exchange: "TOR" }),
      item({ symbol: "VUAA.L", exchange: "LSE" }),
      item({ symbol: "MELI.BA", quoteType: "EQUITY", exchange: "BUE" }),
      item({ symbol: "VTSAX", quoteType: "MUTUALFUND", exchange: "NAS" }),
      item({
        symbol: "BRKB-USD",
        quoteType: "CRYPTOCURRENCY",
        exchange: "CCC",
      }),
      item({ symbol: "^BRKU", exchange: "NIM" }),
      item({ symbol: "BF.B", quoteType: "EQUITY", exchange: "NYQ" }),
      // Sin sufijo pero fuera de las bolsas de EE.UU. que maneja la app (OTC, fondos): solo los
      // descarta el filtro por bolsa, no la validación del símbolo.
      item({ symbol: "TCEHY", quoteType: "EQUITY", exchange: "PNK" }),
      item({ symbol: "ABCDX", quoteType: "ETF", exchange: "NAS" }),
      item({ symbol: "NEWS1", isYahooFinance: false }),
    ]);
    const results = await provider.search("vanguard");
    expect(results.map((r) => r.symbol)).toEqual([
      "VOO",
      "MELI",
      "SOXX",
      "BRK-B",
      "SPYI",
    ]);
    expect(results[1]).toEqual({
      symbol: "MELI",
      name: "MercadoLibre, Inc.",
      type: "STOCK",
      exchange: "NMS",
    });
    expect(results[0]?.type).toBe("ETF");
  });

  it("pide 10 resultados y ninguna noticia", async () => {
    const { provider, calls } = providerWith([]);
    await provider.search("  voo  ");
    expect(calls.search).toEqual([["voo", { quotesCount: 10, newsCount: 0 }]]);
  });

  it("ignora elementos mal formados", async () => {
    const { provider } = providerWith([
      null,
      "x",
      { symbol: 5 },
      item({ symbol: "VOO" }),
    ]);
    expect((await provider.search("voo")).map((r) => r.symbol)).toEqual([
      "VOO",
    ]);
  });

  it.each(["", "   ", "x".repeat(41), "\u0000\u0001", "\n"])(
    "rechaza la búsqueda %j",
    async (query) => {
      const { provider, calls } = providerWith([]);
      await expect(provider.search(query)).rejects.toMatchObject({
        kind: "BAD_REQUEST",
      });
      expect(calls.search).toHaveLength(0);
    },
  );

  it("limpia caracteres de control de la consulta y del nombre", async () => {
    const { provider, calls } = providerWith([
      item({ longname: "Vanguard\u0000 S&P\n500​ ETF" }),
    ]);
    const [result] = await provider.search("van\tguard");
    expect(calls.search[0]?.[0]).toBe("van guard");
    expect(result?.name).toBe("Vanguard S&P 500 ETF");
  });

  it("BAD_DATA si la respuesta no trae `quotes`", async () => {
    const { client } = fakeClient({ search: async () => ({ nope: 1 }) });
    await expect(
      createYahooProvider(client, fastOptions).search("voo"),
    ).rejects.toMatchObject({ kind: "BAD_DATA" });
  });
});

describe("getProfile", () => {
  const providerWith = (summary: unknown) => {
    const { client, calls } = fakeClient({ quoteSummary: async () => summary });
    return { provider: createYahooProvider(client, fastOptions), calls };
  };

  it("arma el perfil de una acción con sector e industria", async () => {
    const { provider, calls } = providerWith({
      assetProfile: {
        sector: "Consumer Cyclical",
        industry: "Internet Retail",
        city: "x",
      },
      price: {
        longName: "MercadoLibre, Inc.",
        quoteType: "EQUITY",
        exchangeName: "NasdaqGS",
        currency: "USD",
      },
    });
    expect(await provider.getProfile?.("MELI")).toEqual({
      symbol: "MELI",
      name: "MercadoLibre, Inc.",
      type: "STOCK",
      exchange: "NasdaqGS",
      currency: "USD",
      sector: "Consumer Cyclical",
      industry: "Internet Retail",
    });
    expect(calls.quoteSummary).toEqual([
      ["MELI", { modules: ["assetProfile", "price"] }],
    ]);
  });

  it("un ETF no trae sector: queda en null", async () => {
    const { provider } = providerWith({
      price: {
        longName: "Vanguard S&P 500 ETF",
        quoteType: "ETF",
        exchangeName: "NYSEArca",
        currency: "USD",
      },
    });
    const profile = await provider.getProfile?.("VOO");
    expect(profile).toMatchObject({
      type: "ETF",
      sector: null,
      industry: null,
    });
  });

  it("tipos que la app no maneja quedan en null y el texto se limpia", async () => {
    const { provider } = providerWith({
      price: { shortName: "Fondo\u0000\n  raro", quoteType: "MUTUALFUND" },
    });
    expect(await provider.getProfile?.("VTSAX")).toMatchObject({
      name: "Fondo raro",
      type: null,
      exchange: null,
      currency: null,
    });
  });

  it("símbolo desconocido (quoteSummary lanza 'Quote not found'): NOT_FOUND", async () => {
    const { client } = fakeClient({
      quoteSummary: async () => {
        throw new Error("Quote not found for ticker symbol: ZZZZ");
      },
    });
    await expect(
      createYahooProvider(client, fastOptions).getProfile?.("ZZZZ"),
    ).rejects.toMatchObject({ kind: "NOT_FOUND", symbol: "ZZZZ" });
  });
});
