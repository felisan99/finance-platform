import { describe, expect, it } from "vitest";
import { MarketDataError } from "../errors";
import { createYahooProvider } from "../yahoo";
import { parseCompanyData } from "../yahoo-company";
import {
  bar,
  chartResponse,
  fakeClient,
  fastOptions,
  httpError,
} from "./helpers";

// Respuestas con la forma y los valores de los probes contra Yahoo real (GOOGL y VOO, 2026-09-25).

const googlDetail = {
  maxAge: 1,
  priceHint: 2,
  previousClose: 342.36,
  open: 342.41,
  dayLow: 341.11,
  dayHigh: 347.03,
  dividendRate: 0.88,
  dividendYield: 0.0026,
  exDividendDate: new Date("2026-09-04T00:00:00.000Z"),
  beta: 1.225,
  trailingPE: 17.256397,
  forwardPE: 23.083103,
  volume: 21242195,
  averageVolume: 28826158,
  marketCap: 4206119354368,
  fiftyTwoWeekLow: 235.84,
  fiftyTwoWeekHigh: 408.61,
  priceToSalesTrailing12Months: 9.433596,
  bid: 344.16,
};
const googlStats = {
  maxAge: 1,
  floatShares: 10879441100,
  sharesOutstanding: 5867155790,
  impliedSharesOutstanding: 12229934831,
  bookValue: 50.896,
  priceToBook: 6.7573094,
  trailingEps: 19.93,
  category: null,
  lastSplitFactor: "20:1",
};
const googlBase = {
  summaryDetail: googlDetail,
  defaultKeyStatistics: googlStats,
};
const googlExtra = {
  earningsHistory: {
    maxAge: 1,
    history: [
      {
        epsActual: 2.87,
        epsEstimate: 2.26204,
        epsDifference: 0.61,
        surprisePercent: 0.2688,
        quarter: new Date("2025-09-30T00:00:00.000Z"),
      },
      {
        epsActual: 2.82,
        epsEstimate: 2.63521,
        epsDifference: 0.18,
        quarter: new Date("2025-12-31T00:00:00.000Z"),
      },
      {
        epsActual: 5.11,
        epsEstimate: 2.66714,
        epsDifference: 2.44,
        quarter: new Date("2026-03-31T00:00:00.000Z"),
      },
      {
        epsActual: 9.11,
        epsEstimate: 2.89914,
        epsDifference: 6.21,
        quarter: new Date("2026-06-30T00:00:00.000Z"),
      },
    ],
  },
  calendarEvents: {
    earnings: {
      earningsDate: [new Date("2026-10-28T20:00:00.000Z")],
      isEarningsDateEstimate: false,
    },
    exDividendDate: new Date("2026-09-04T00:00:00.000Z"),
  },
};

const vooBase = {
  summaryDetail: {
    previousClose: 706.99,
    open: 708.44,
    dayLow: 706.175,
    dayHigh: 711.645,
    trailingPE: 25.001913,
    volume: 5421633,
    averageVolume: 7081333,
    yield: 0.0104,
    totalAssets: 1756880437248,
    fiftyTwoWeekLow: 578.46,
    fiftyTwoWeekHigh: 716.39,
    navPrice: 707.38,
    currency: "USD",
  },
  defaultKeyStatistics: {
    category: "Large Blend",
    ytdReturn: 0.1352525,
    totalAssets: 1756880437248,
    yield: 0.0104,
    fundFamily: "Vanguard",
  },
};

describe("parseCompanyData: acción", () => {
  const data = parseCompanyData("stock", googlBase, googlExtra);

  it("arma los montos como strings decimales y las cantidades como enteros", () => {
    expect(data).toMatchObject({
      kind: "stock",
      previousClose: "342.36",
      open: "342.41",
      dayLow: "341.11",
      dayHigh: "347.03",
      fiftyTwoWeekLow: "235.84",
      fiftyTwoWeekHigh: "408.61",
      volume: 21242195,
      averageVolume: 28826158,
      marketCap: 4206119354368,
      trailingPE: "17.2564",
      forwardPE: "23.0831",
      epsTrailing: "19.93",
      dividendRate: "0.88",
      dividendYield: "0.0026",
      priceToBook: "6.7573",
      bookValue: "50.896",
      priceToSales: "9.4336",
      beta: "1.225",
      exDividendDate: "2026-09-04",
      nextEarningsDate: "2026-10-28",
    });
  });

  it("usa las acciones totales (implícitas) y no solo las de la clase A", () => {
    expect(data.sharesOutstanding).toBe(12229934831);
    expect(data.floatShares).toBe(10879441100);
  });

  it("los campos de un fondo quedan vacíos en una acción", () => {
    expect(data.totalAssets).toBeNull();
    expect(data.navPrice).toBeNull();
    expect(data.category).toBeNull();
    expect(data.ytdReturn).toBeNull();
  });

  it("trae los 4 trimestres ordenados, con real, estimado y diferencia", () => {
    expect(data.earnings).toEqual([
      {
        periodEnd: "2025-09-30",
        epsActual: "2.87",
        epsEstimate: "2.262",
        epsDifference: "0.61",
      },
      {
        periodEnd: "2025-12-31",
        epsActual: "2.82",
        epsEstimate: "2.6352",
        epsDifference: "0.18",
      },
      {
        periodEnd: "2026-03-31",
        epsActual: "5.11",
        epsEstimate: "2.6671",
        epsDifference: "2.44",
      },
      {
        periodEnd: "2026-06-30",
        epsActual: "9.11",
        epsEstimate: "2.8991",
        epsDifference: "6.21",
      },
    ]);
  });

  it("se queda con los 4 más nuevos y ordena aunque lleguen desordenados", () => {
    const quarters = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
    const extra = {
      earningsHistory: {
        history: [...quarters, "2024-12-31"].reverse().map((q, i) => ({
          quarter: new Date(`${q}T00:00:00.000Z`),
          epsActual: i + 1,
          epsEstimate: 1,
          epsDifference: i,
        })),
      },
    };
    const result = parseCompanyData("stock", googlBase, extra);
    expect(result.earnings.map((e) => e.periodEnd)).toEqual(quarters);
  });

  it("un trimestre sin BPA real (todavía no publicado) no se muestra", () => {
    const extra = {
      earningsHistory: {
        history: [
          {
            quarter: new Date("2026-06-30T00:00:00.000Z"),
            epsActual: null,
            epsEstimate: 2.9,
          },
          {
            quarter: new Date("2026-03-31T00:00:00.000Z"),
            epsActual: 5.11,
            epsEstimate: 2.66,
            epsDifference: 2.45,
          },
        ],
      },
    };
    expect(
      parseCompanyData("stock", googlBase, extra).earnings.map(
        (e) => e.periodEnd,
      ),
    ).toEqual(["2026-03-31"]);
  });

  it("acepta un BPA negativo (pérdida) y un estimado que falta", () => {
    const extra = {
      earningsHistory: {
        history: [
          {
            quarter: new Date("2026-03-31T00:00:00.000Z"),
            epsActual: -0.42,
            epsEstimate: null,
            epsDifference: null,
          },
        ],
      },
    };
    expect(parseCompanyData("stock", googlBase, extra).earnings).toEqual([
      {
        periodEnd: "2026-03-31",
        epsActual: "-0.42",
        epsEstimate: null,
        epsDifference: null,
      },
    ]);
  });

  it("la fecha de resultados es el día de Nueva York, no el UTC", () => {
    const extra = {
      calendarEvents: {
        earnings: { earningsDate: [new Date("2026-10-29T01:30:00.000Z")] },
      },
    };
    expect(parseCompanyData("stock", googlBase, extra).nextEarningsDate).toBe(
      "2026-10-28",
    );
  });
});

describe("parseCompanyData: ETF", () => {
  const data = parseCompanyData("etf", vooBase, null);

  it("usa el rendimiento del fondo como rentabilidad y trae su patrimonio, cuota y categoría", () => {
    expect(data).toMatchObject({
      kind: "etf",
      previousClose: "706.99",
      dayLow: "706.175",
      dayHigh: "711.645",
      fiftyTwoWeekLow: "578.46",
      fiftyTwoWeekHigh: "716.39",
      dividendYield: "0.0104",
      totalAssets: 1756880437248,
      navPrice: "707.38",
      category: "Large Blend",
      ytdReturn: "0.135253",
      trailingPE: "25.0019",
      currency: "USD",
    });
  });

  it("no tiene ganancias ni acciones en circulación", () => {
    expect(data.earnings).toEqual([]);
    expect(data.nextEarningsDate).toBeNull();
    expect(data.sharesOutstanding).toBeNull();
    expect(data.epsTrailing).toBeNull();
  });
});

describe("parseCompanyData: datos rotos o incompletos", () => {
  it("un campo con otro tipo queda vacío y no tira abajo al resto", () => {
    const base = {
      summaryDetail: {
        ...googlDetail,
        marketCap: "4.2T",
        trailingPE: { raw: 17.2 },
        volume: Number.NaN,
      },
      defaultKeyStatistics: googlStats,
    };
    const data = parseCompanyData("stock", base, null);
    expect(data.marketCap).toBeNull();
    expect(data.trailingPE).toBeNull();
    expect(data.volume).toBeNull();
    expect(data.previousClose).toBe("342.36");
    expect(data.epsTrailing).toBe("19.93");
  });

  it("valores imposibles (negativos, cero, absurdos) se descartan", () => {
    const base = {
      summaryDetail: {
        previousClose: -5,
        open: 0,
        marketCap: 1e30,
        volume: -10,
        trailingPE: -3,
        dividendYield: 0,
        fiftyTwoWeekHigh: Number.POSITIVE_INFINITY,
      },
      defaultKeyStatistics: { trailingEps: 1e30 },
    };
    const data = parseCompanyData("stock", base, null);
    expect(data.previousClose).toBeNull();
    expect(data.open).toBeNull();
    expect(data.marketCap).toBeNull();
    expect(data.volume).toBeNull();
    expect(data.trailingPE).toBeNull();
    expect(data.dividendYield).toBeNull();
    expect(data.fiftyTwoWeekHigh).toBeNull();
    expect(data.epsTrailing).toBeNull();
  });

  it("un BPA negativo del período sí se acepta (la empresa pierde plata)", () => {
    const data = parseCompanyData(
      "stock",
      {
        summaryDetail: googlDetail,
        defaultKeyStatistics: { trailingEps: -1.5 },
      },
      null,
    );
    expect(data.epsTrailing).toBe("-1.5");
  });

  it("sin módulos: todo vacío, sin error (la ficha oculta la tarjeta)", () => {
    const data = parseCompanyData("stock", {}, null);
    expect(data.previousClose).toBeNull();
    expect(data.marketCap).toBeNull();
    expect(data.earnings).toEqual([]);
  });

  it("módulos que no son objetos: vacío, sin error", () => {
    const data = parseCompanyData(
      "stock",
      { summaryDetail: "x", defaultKeyStatistics: 5 },
      { earningsHistory: [], calendarEvents: "y" },
    );
    expect(data.previousClose).toBeNull();
    expect(data.earnings).toEqual([]);
  });

  it("una respuesta que ni siquiera es un objeto es BAD_DATA", () => {
    for (const raw of [null, undefined, "x", 5, []]) {
      expect(() => parseCompanyData("stock", raw, null, "GOOGL")).toThrow(
        MarketDataError,
      );
    }
  });

  it("un elemento roto de la historia se omite y el resto sigue", () => {
    const extra = {
      earningsHistory: {
        history: [
          "basura",
          null,
          {
            quarter: new Date("2026-03-31T00:00:00.000Z"),
            epsActual: 5.11,
            epsEstimate: 2.66,
            epsDifference: 2.45,
          },
          { quarter: "2026-06-30", epsActual: 9 },
        ],
      },
    };
    expect(
      parseCompanyData("stock", googlBase, extra).earnings.map(
        (e) => e.periodEnd,
      ),
    ).toEqual(["2026-03-31"]);
  });

  it("los textos se limpian: la categoría no trae saltos de línea ni caracteres invisibles", () => {
    const base = {
      summaryDetail: {},
      defaultKeyStatistics: { category: "Large\nBlend​   Fund" },
    };
    expect(parseCompanyData("etf", base, null).category).toBe(
      "Large Blend Fund",
    );
  });
});

describe("getCompanyData (proveedor)", () => {
  const stockClient = (
    extra: () => Promise<unknown> = async () => googlExtra,
  ) =>
    fakeClient({
      quoteSummary: async (_symbol, { modules }) =>
        modules.includes("earningsHistory") ? extra() : googlBase,
    });

  it("una acción pide dos consultas: las de siempre y, aparte, ganancias y calendario", async () => {
    const { client, calls } = stockClient();
    const data = await createYahooProvider(client, fastOptions).getCompanyData!(
      "GOOGL",
      "stock",
    );
    expect(
      calls.quoteSummary.map((c) => (c[1] as { modules: string[] }).modules),
    ).toEqual([
      ["summaryDetail", "defaultKeyStatistics"],
      ["earningsHistory", "calendarEvents"],
    ]);
    expect(data.earnings).toHaveLength(4);
  });

  it("un ETF NO pide ganancias (Yahoo responde «No fundamentals data found»)", async () => {
    const { client, calls } = fakeClient({ quoteSummary: async () => vooBase });
    const data = await createYahooProvider(client, fastOptions).getCompanyData!(
      "VOO",
      "etf",
    );
    expect(calls.quoteSummary).toHaveLength(1);
    expect(data.kind).toBe("etf");
    expect(data.totalAssets).toBe(1756880437248);
  });

  it("si Yahoo no tiene ganancias de una acción, sigue con el resto y no reintenta", async () => {
    const { client, calls } = stockClient(async () => {
      throw new Error("No fundamentals data found for symbol: NEWCO");
    });
    const data = await createYahooProvider(client, fastOptions).getCompanyData!(
      "NEWCO",
      "stock",
    );
    expect(data.previousClose).toBe("342.36");
    expect(data.earnings).toEqual([]);
    // 1 de las de siempre + 1 de ganancias (sin reintentos: es un «no hay datos», no un corte).
    expect(calls.quoteSummary).toHaveLength(2);
  });

  it("si Yahoo responde con un formato que la librería no reconoce en las ganancias, sigue con el resto", async () => {
    const { client } = stockClient(async () => {
      const error = new Error("validación");
      error.name = "FailedYahooValidationError";
      throw error;
    });
    const data = await createYahooProvider(client, fastOptions).getCompanyData!(
      "GOOGL",
      "stock",
    );
    expect(data.previousClose).toBe("342.36");
    expect(data.earnings).toEqual([]);
  });

  it("un corte o un límite de ritmo en las ganancias NO se disimula (no se cachearía un resultado incompleto)", async () => {
    const { client } = stockClient(async () => {
      throw httpError(429);
    });
    await expect(
      createYahooProvider(client, { ...fastOptions, retries: 0 })
        .getCompanyData!("GOOGL", "stock"),
    ).rejects.toMatchObject({ kind: "RATE_LIMITED" });
  });

  it("un símbolo que Yahoo no conoce es NOT_FOUND", async () => {
    const { client } = fakeClient({
      quoteSummary: async () => {
        throw new Error("Quote not found for symbol: ZZZZQQ");
      },
    });
    await expect(
      createYahooProvider(client, fastOptions).getCompanyData!(
        "ZZZZQQ",
        "stock",
      ),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
  });

  it("un símbolo con formato raro se rechaza antes de llamar", async () => {
    const { client, calls } = fakeClient({
      quoteSummary: async () => googlBase,
    });
    await expect(
      createYahooProvider(client, fastOptions).getCompanyData!("../x", "stock"),
    ).rejects.toMatchObject({ kind: "BAD_REQUEST" });
    expect(calls.quoteSummary).toHaveLength(0);
  });
});

describe("getIntradaySeries", () => {
  const NOW = new Date("2026-09-25T20:30:00.000Z");
  const providerFor = (chart: unknown) => {
    const { client, calls } = fakeClient({ chart: async () => chart });
    return {
      provider: createYahooProvider(client, { ...fastOptions, now: () => NOW }),
      calls,
    };
  };
  // Dos barras de 30 min por rueda, en las 8 ruedas de las dos últimas semanas.
  const sessions = [
    "2026-09-16",
    "2026-09-17",
    "2026-09-18",
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
  ];
  const twoWeeks = sessions.flatMap((day, i) => [
    bar(`${day}T13:30:00.000Z`, 100 + i),
    bar(`${day}T14:00:00.000Z`, 100.5 + i),
  ]);

  it("la semana pide barras de 30 minutos de los últimos 7 días y deja las 5 últimas ruedas", async () => {
    const { provider, calls } = providerFor(
      chartResponse({ quotes: twoWeeks }),
    );
    const points = await provider.getIntradaySeries!("GOOGL", "1w");
    expect(calls.chart[0]).toEqual([
      "GOOGL",
      {
        period1: new Date("2026-09-18T20:30:00.000Z"),
        period2: NOW,
        interval: "30m",
      },
    ]);
    expect([
      ...new Set(points.map((p) => p.at.toISOString().slice(0, 10))),
    ]).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
    expect(points).toHaveLength(10);
  });

  it("el mes pide barras de 1 hora de los últimos 31 días y las deja todas", async () => {
    const { provider, calls } = providerFor(
      chartResponse({ quotes: twoWeeks }),
    );
    const points = await provider.getIntradaySeries!("GOOGL", "1m");
    expect(calls.chart[0]).toEqual([
      "GOOGL",
      {
        period1: new Date("2026-08-25T20:30:00.000Z"),
        period2: NOW,
        interval: "1h",
      },
    ]);
    expect(points).toHaveLength(16);
  });

  it("descarta barras sin cierre o con cierre no positivo y redondea el ruido de float32", async () => {
    const { provider } = providerFor(
      chartResponse({
        quotes: [
          bar("2026-09-25T13:30:00.000Z", 343.92001953125),
          bar("2026-09-25T14:00:00.000Z", null),
          bar("2026-09-25T14:30:00.000Z", 0),
          bar("2026-09-25T15:00:00.000Z", -3),
        ],
      }),
    );
    const points = await provider.getIntradaySeries!("GOOGL", "1m");
    expect(points).toEqual([
      { at: new Date("2026-09-25T13:30:00.000Z"), close: "343.92" },
    ]);
  });

  it("ordena de la más vieja a la más nueva y quita barras repetidas", async () => {
    const { provider } = providerFor(
      chartResponse({
        quotes: [
          bar("2026-09-25T15:00:00.000Z", 3),
          bar("2026-09-25T13:30:00.000Z", 1),
          bar("2026-09-25T14:00:00.000Z", 2),
          bar("2026-09-25T14:00:00.000Z", 2.5),
        ],
      }),
    );
    const points = await provider.getIntradaySeries!("GOOGL", "1m");
    expect(points.map((p) => p.close)).toEqual(["1", "2.5", "3"]);
  });

  it("una respuesta con formato inesperado es BAD_DATA", async () => {
    const { provider } = providerFor({ quotes: "x" });
    await expect(
      provider.getIntradaySeries!("GOOGL", "1w"),
    ).rejects.toMatchObject({ kind: "BAD_DATA" });
  });

  it("una zona horaria inválida es BAD_DATA en la semana", async () => {
    const { provider } = providerFor(
      chartResponse({ quotes: twoWeeks, timeZone: "Marte/Olimpo" }),
    );
    await expect(
      provider.getIntradaySeries!("GOOGL", "1w"),
    ).rejects.toMatchObject({ kind: "BAD_DATA" });
  });

  it("un símbolo con formato raro se rechaza antes de llamar", async () => {
    const { provider, calls } = providerFor(chartResponse());
    await expect(
      provider.getIntradaySeries!("a b", "1w"),
    ).rejects.toMatchObject({
      kind: "BAD_REQUEST",
    });
    expect(calls.chart).toHaveLength(0);
  });
});
