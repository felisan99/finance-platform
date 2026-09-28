import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { d, type DailyClose } from "@/lib/engine";
import type { LiveQuote } from "../live-series";
import { assemblePerformance } from "../performance-build";
import type { PortfolioRef } from "../portfolio-scope";
import type { AccountRow, InstrumentRow, TransactionRow } from "../rows";
import { buildSnapshot } from "../snapshot";

// El punto en vivo tiene que cerrar con Inicio: la última fila de la serie vale lo mismo que el
// "Valor total" de arriba y la ganancia de "Todo" es la "Ganancia total" de arriba.

const account: AccountRow = {
  id: "acc-1",
  name: "Cuenta principal",
  currency: "USD",
  cost_method: "AVERAGE",
};
const portfolio = {
  id: "p-1",
  name: "Principal",
  benchmarkSymbol: "SPY",
  account,
};
const instrument = (symbol: string): InstrumentRow => ({
  id: `id-${symbol}`,
  symbol,
  name: null,
  type: null,
  exchange: null,
  sector: null,
  provider_symbol: null,
});

let seq = 0;
function row(
  type: TransactionRow["type"],
  iso: string,
  symbol: string | null,
  fields: Partial<TransactionRow>,
): TransactionRow {
  seq += 1;
  return {
    id: `t${seq}`,
    type,
    instrument_id: symbol === null ? null : `id-${symbol}`,
    executed_at: iso,
    quantity: null,
    price: null,
    amount: null,
    fee: "0",
    currency: "USD",
    split_ratio: null,
    notes: null,
    source: "manual",
    external_id: null,
    created_at: "2026-09-21T10:00:00+00:00",
    seq,
    ...fields,
  };
}

const rows = [
  row("DEPOSIT", "2026-09-21T15:00:00+00:00", null, { amount: "2000" }),
  row("BUY", "2026-09-21T15:00:00+00:00", "VOO", {
    quantity: "10",
    price: "100",
  }),
  row("BUY", "2026-09-22T15:00:00+00:00", "AAPL", {
    quantity: "3",
    price: "200",
  }),
  row("DEPOSIT", "2026-09-23T15:00:00+00:00", null, { amount: "500" }),
  row("BUY", "2026-09-23T15:00:00+00:00", "VOO", {
    quantity: "2",
    price: "105",
  }),
];
const NET_DEPOSITS = d("2500");

const series = (rowsOf: ReadonlyArray<readonly [string, string]>) =>
  rowsOf.map(([date, close]): DailyClose => ({ date, close: d(close) }));
const closes = new Map([
  [
    "VOO",
    series([
      ["2026-09-21", "100"],
      ["2026-09-22", "102"],
      ["2026-09-23", "105"],
      ["2026-09-24", "104"],
    ]),
  ],
  [
    "AAPL",
    series([
      ["2026-09-22", "200"],
      ["2026-09-23", "205"],
      ["2026-09-24", "203"],
    ]),
  ],
]);
const spy = series([
  ["2026-09-18", "500"],
  ["2026-09-21", "502"],
  ["2026-09-22", "504"],
  ["2026-09-23", "508"],
  ["2026-09-24", "506"],
]);

const closeRows = [
  { s: "VOO", last: ["2026-09-24", "104"], prev: ["2026-09-23", "105"] },
  { s: "AAPL", last: ["2026-09-24", "203"], prev: ["2026-09-23", "205"] },
] as const;

function snapshotWith(
  vooPrice: string,
  aaplPrice: string,
  asOf: string,
  /** Con otro portafolio además, visto con «Todo junto». */
  second?: { portfolio: PortfolioRef; rows: TransactionRow[] },
) {
  return buildSnapshot({
    scope: second
      ? { kind: "all", portfolios: [portfolio, second.portfolio] }
      : { kind: "one", portfolio },
    parts: [
      { portfolio, transactionRows: rows },
      ...(second
        ? [{ portfolio: second.portfolio, transactionRows: second.rows }]
        : []),
    ],
    instruments: [instrument("VOO"), instrument("AAPL")],
    quotes: [
      { instrument_id: "id-VOO", price: vooPrice, change: null, as_of: asOf },
      { instrument_id: "id-AAPL", price: aaplPrice, change: null, as_of: asOf },
    ],
    closes: closeRows.map(({ s, last, prev }) => ({
      instrument_id: `id-${s}`,
      last_date: last[0],
      last_close: last[1],
      prev_date: prev[0],
      prev_close: prev[1],
    })),
  });
}

const spyQuote = (price: string, asOf: string): LiveQuote => ({
  price: d(price),
  asOf: new Date(asOf),
});

const LIVE = "2026-09-25T17:30:00+00:00";

function assemble(
  snapshot: ReturnType<typeof snapshotWith>,
  benchmarkQuote: LiveQuote | null,
) {
  const built = assemblePerformance({
    snapshot,
    closes,
    benchmarkCloses: spy,
    benchmarkQuote,
    benchmarkSymbol: "SPY",
  });
  if (!built) throw new Error("sin rendimiento");
  return built;
}

describe("assemblePerformance con la cotización de hoy", () => {
  it("la serie llega hasta hoy y su último valor es el valor total de Inicio", () => {
    const snapshot = snapshotWith("110", "210", LIVE);
    const { result } = assemble(snapshot, spyQuote("512", LIVE));
    const last = result.series.points.at(-1)!;
    expect(last.date).toBe("2026-09-25");
    // 12 VOO × 110 + 3 AAPL × 210 + efectivo (2500 − 1000 − 600 − 210 = 690)
    expect(last.value.toFixed()).toBe("2640");
    expect(last.value.eq(snapshot.valued.totalValue)).toBe(true);
  });

  it("la ganancia de «Todo» es la ganancia total de Inicio: valor − depósitos", () => {
    const snapshot = snapshotWith("110", "210", LIVE);
    const { result } = assemble(snapshot, spyQuote("512", LIVE));
    const max = result.periods.find((p) => p.id === "MAX")!;
    expect(max.endDate).toBe("2026-09-25");
    expect(max.gain.eq(snapshot.valued.totalValue.minus(NET_DEPOSITS))).toBe(
      true,
    );
  });

  it("el benchmark llega al mismo día: su retorno de hoy entra en la comparación", () => {
    const snapshot = snapshotWith("110", "210", LIVE);
    const { result } = assemble(snapshot, spyQuote("512", LIVE));
    const max = result.periods.find((p) => p.id === "MAX")!;
    // 512 sobre el cierre del día base (18/09): 500.
    expect(max.benchmarkReturn?.toFixed()).toBe("0.024");
  });

  it("la vista rotula el punto: cierres al último cierre real y la hora de la cotización", () => {
    const snapshot = snapshotWith("110", "210", LIVE);
    const { view } = assemble(snapshot, spyQuote("512", LIVE));
    expect(view.asOf).toBe("24/09/2026");
    expect(view.live).toBe("25/09/2026 14:30");
    expect(view.monthly.at(-1)?.note).toBe(
      "desde el 21/09, en curso, con la cotización de hoy",
    );
    expect(view.risk?.note).toContain("Incluye la cotización de hoy");
  });

  it("sin cotización del benchmark de hoy todo queda con cierres, como antes", () => {
    const snapshot = snapshotWith("110", "210", LIVE);
    const { result, view } = assemble(snapshot, null);
    expect(result.series.points.at(-1)?.date).toBe("2026-09-24");
    expect(view.live).toBeNull();
    expect(view.asOf).toBe("24/09/2026");
    expect(view.monthly.at(-1)?.note).toBe("desde el 21/09, en curso");
    expect(view.risk?.note ?? "").not.toContain("cotización de hoy");
  });

  it("cotizaciones del día del último cierre: el cierre gana y la serie no cambia", () => {
    const sameDay = "2026-09-24T20:00:00+00:00";
    const snapshot = snapshotWith("104", "203", sameDay);
    const { result, view } = assemble(snapshot, spyQuote("506", sameDay));
    expect(result.series.points.at(-1)?.date).toBe("2026-09-24");
    expect(view.live).toBeNull();
  });

  it("un rendimiento con el punto en vivo no cambia nada de lo anterior a hoy", () => {
    const snapshot = snapshotWith("110", "210", LIVE);
    const live = assemble(snapshot, spyQuote("512", LIVE)).result.series.points;
    const plain = assemble(snapshot, null).result.series.points;
    expect(live.slice(0, plain.length).map((p) => p.value.toFixed())).toEqual(
      plain.map((p) => p.value.toFixed()),
    );
  });

  it("propiedad: para cualquier cotización de hoy, el último valor de la serie es el valor total de Inicio", () => {
    const cents = fc.integer({ min: 1_000, max: 100_000 });
    fc.assert(
      fc.property(cents, cents, cents, (voo, aapl, benchmark) => {
        const snapshot = snapshotWith(
          (voo / 100).toFixed(2),
          (aapl / 100).toFixed(2),
          LIVE,
        );
        const { result } = assemble(
          snapshot,
          spyQuote((benchmark / 100).toFixed(2), LIVE),
        );
        const last = result.series.points.at(-1)!;
        const max = result.periods.find((p) => p.id === "MAX")!;
        return (
          last.date === "2026-09-25" &&
          last.value.eq(snapshot.valued.totalValue) &&
          max.gain.eq(snapshot.valued.totalValue.minus(NET_DEPOSITS))
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe("assemblePerformance con «Todo junto»", () => {
  const cripto: PortfolioRef = {
    id: "p-2",
    name: "Cripto",
    benchmarkSymbol: "SPY",
    account: { ...account, id: "acc-2" },
  };
  // Arranca después que el primero, con AAPL también: el mismo símbolo en los dos.
  const criptoRows = [
    row("DEPOSIT", "2026-09-22T15:00:00+00:00", null, { amount: "1000" }),
    row("BUY", "2026-09-23T15:00:00+00:00", "AAPL", {
      quantity: "2",
      price: "205",
    }),
    row("WITHDRAWAL", "2026-09-24T15:00:00+00:00", null, { amount: "100" }),
  ];
  const both = (voo: string, aapl: string) =>
    snapshotWith(voo, aapl, LIVE, { portfolio: cripto, rows: criptoRows });

  it("la serie es la suma de los dos y su último valor es el valor total de Inicio", () => {
    const snapshot = both("110", "210");
    const { result } = assemble(snapshot, spyQuote("512", LIVE));
    const last = result.series.points.at(-1)!;
    expect(last.date).toBe("2026-09-25");
    // Primero 2640 (como arriba) + segundo: 2 AAPL × 210 + efectivo (1000 − 410 − 100 = 490).
    expect(last.value.toFixed()).toBe("3550");
    expect(last.value.eq(snapshot.valued.totalValue)).toBe(true);
    const max = result.periods.find((p) => p.id === "MAX")!;
    expect(
      max.gain.eq(snapshot.valued.totalValue.minus(NET_DEPOSITS).minus(900)),
    ).toBe(true);
  });

  it("propiedad: con cualquier cotización, la serie sumada cierra con Inicio", () => {
    const cents = fc.integer({ min: 1_000, max: 100_000 });
    fc.assert(
      fc.property(cents, cents, (voo, aapl) => {
        const snapshot = both((voo / 100).toFixed(2), (aapl / 100).toFixed(2));
        const { result } = assemble(snapshot, spyQuote("512", LIVE));
        const last = result.series.points.at(-1)!;
        const max = result.periods.find((p) => p.id === "MAX")!;
        return (
          last.value.eq(snapshot.valued.totalValue) &&
          max.gain.eq(snapshot.valued.totalValue.minus(NET_DEPOSITS).minus(900))
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe("assemblePerformance con cripto un fin de semana", () => {
  const cryptoRows = [
    row("DEPOSIT", "2026-09-21T15:00:00+00:00", null, { amount: "2000" }),
    row("BUY", "2026-09-21T15:00:00+00:00", "VOO", {
      quantity: "10",
      price: "100",
    }),
    row("BUY", "2026-09-22T15:00:00+00:00", "BTC-USD", {
      quantity: "0.01",
      price: "80000",
    }),
  ];
  const btcCloses = series([
    ["2026-09-21", "79000"],
    ["2026-09-22", "80000"],
    ["2026-09-23", "81000"],
    ["2026-09-24", "80500"],
    ["2026-09-25", "82000"],
    ["2026-09-26", "83000"], // sábado
  ]);
  const vooCloses = series([
    ["2026-09-21", "100"],
    ["2026-09-22", "102"],
    ["2026-09-23", "105"],
    ["2026-09-24", "104"],
    ["2026-09-25", "106"],
  ]);
  const SUNDAY = "2026-09-27T15:00:00+00:00";

  function sunday(btc: string) {
    return buildSnapshot({
      scope: { kind: "one", portfolio },
      parts: [{ portfolio, transactionRows: cryptoRows }],
      instruments: [instrument("VOO"), instrument("BTC-USD")],
      quotes: [
        // VOO: la cotización del viernes (la bolsa no abrió desde entonces).
        {
          instrument_id: "id-VOO",
          price: "106",
          change: null,
          as_of: "2026-09-25T20:00:00+00:00",
        },
        {
          instrument_id: "id-BTC-USD",
          price: btc,
          change: null,
          as_of: SUNDAY,
        },
      ],
      closes: [
        {
          instrument_id: "id-VOO",
          last_date: "2026-09-25",
          last_close: "106",
          prev_date: "2026-09-24",
          prev_close: "104",
        },
        {
          instrument_id: "id-BTC-USD",
          last_date: "2026-09-26",
          last_close: "83000",
          prev_date: "2026-09-25",
          prev_close: "82000",
        },
      ],
    });
  }

  const assembleSunday = (snapshot: ReturnType<typeof sunday>) => {
    const built = assemblePerformance({
      snapshot,
      closes: new Map([
        ["VOO", vooCloses],
        ["BTC-USD", btcCloses],
      ]),
      // SPY: el último cierre y la cotización son del viernes.
      benchmarkCloses: series([
        ["2026-09-18", "500"],
        ["2026-09-25", "506"],
      ]),
      benchmarkQuote: spyQuote("506", "2026-09-25T20:00:00+00:00"),
      benchmarkSymbol: "SPY",
    });
    if (!built) throw new Error("sin rendimiento");
    return built;
  };

  it("el domingo es el último punto y vale lo mismo que Inicio", () => {
    const snapshot = sunday("84000");
    const { result } = assembleSunday(snapshot);
    const last = result.series.points.at(-1)!;
    expect(last.date).toBe("2026-09-27");
    // 10 VOO × 106 + 0,01 BTC × 84000 + efectivo (2000 − 1000 − 800 = 200).
    expect(last.value.toFixed()).toBe("2100");
    expect(last.value.eq(snapshot.valued.totalValue)).toBe(true);
    // El sábado no es un punto: la grilla son días hábiles y solo el final puede ser fin de semana.
    expect(result.series.points.some((p) => p.date === "2026-09-26")).toBe(
      false,
    );
  });

  it("propiedad: cualquier cotización de la cripto del domingo cierra con Inicio", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000_000, max: 20_000_000 }), (cents) => {
        const snapshot = sunday((cents / 100).toFixed(2));
        const { result } = assembleSunday(snapshot);
        const max = result.periods.find((p) => p.id === "MAX")!;
        return (
          result.series.points.at(-1)!.value.eq(snapshot.valued.totalValue) &&
          max.gain.eq(snapshot.valued.totalValue.minus(2000))
        );
      }),
      { numRuns: 200 },
    );
  });
});
