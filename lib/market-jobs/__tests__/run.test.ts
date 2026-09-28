import { describe, expect, it } from "vitest";
import { D } from "@/lib/engine/decimal";
import { MarketDataError } from "@/lib/market-data";
import {
  ADJUST_TOLERANCE,
  desiredStart,
  needsBackfill,
  refreshQuotes,
  runMarketJob,
  type ActiveInstrument,
  type JobName,
} from "..";
import { FakeMarket, MemoryStore, marketState } from "./memory";

// "Hoy" = 2026-09-24 a las 22:00 UTC (después del cierre de NY). La serie llega hasta el 23.
const NOW = new Date("2026-09-24T22:00:00.000Z");
const SERIES_FROM = "2026-01-01";
const SERIES_TO = "2026-09-23";
// Todo instrumento guarda al menos 5 años (desiredStart): la ventana del primer backfill.
const FIVE_YEARS = "2021-09-24";

function setup() {
  const market = new FakeMarket();
  const store = new MemoryStore();
  const run = (
    options: {
      job?: JobName;
      now?: Date;
      budgetMs?: number;
      clock?: () => number;
    } = {},
  ) =>
    runMarketJob({
      job: options.job ?? "daily-prices",
      provider: market,
      store,
      now: options.now ?? NOW,
      budgetMs: options.budgetMs,
      clock: options.clock,
    });
  /** Alta de un instrumento con serie de mercado y su primera transacción. */
  const add = (symbol: string, firstTxDate = "2026-03-09", base = 100) => {
    market.addSeries(symbol, SERIES_FROM, SERIES_TO, base);
    return store.addInstrument(symbol, { firstTxDate });
  };
  return { market, store, run, add };
}

const only = (
  rows: Array<{ date: string; close: string; adjClose: string | null }>,
  from: string,
) => rows.filter((r) => r.date >= from);

describe("desiredStart", () => {
  const base: ActiveInstrument = {
    id: "1",
    symbol: "X",
    providerSymbol: null,
    historyBackfilledAt: null,
    historyFrom: null,
    firstTxDate: null,
    inWatchlist: false,
    latestPriceDate: null,
  };

  it.each([
    [
      "transacción reciente: igual 5 años atrás (lo pide «Antes de comprar»)",
      { firstTxDate: "2026-03-09" },
      "2021-09-24",
    ],
    ["solo watchlist: 5 años atrás", { inWatchlist: true }, "2021-09-24"],
    [
      "ambas y transacción reciente: 5 años atrás",
      { firstTxDate: "2026-03-09", inWatchlist: true },
      "2021-09-24",
    ],
    [
      "transacción de hace más de 5 años: manda la transacción menos 7 días",
      { firstTxDate: "2019-01-10" },
      "2019-01-03",
    ],
    [
      "el margen de 7 días cruza el año",
      { firstTxDate: "2021-01-03" },
      "2020-12-27",
    ],
    ["ninguna (no debería pasar): 5 años", {}, "2021-09-24"],
  ])("%s", (_label, patch, expected) => {
    expect(desiredStart({ ...base, ...patch }, "2026-09-24")).toBe(expected);
  });
});

describe("needsBackfill", () => {
  const done: ActiveInstrument = {
    id: "1",
    symbol: "X",
    providerSymbol: null,
    historyBackfilledAt: "2026-09-01T00:00:00.000Z",
    historyFrom: "2026-03-02",
    firstTxDate: "2026-03-09",
    inWatchlist: false,
    latestPriceDate: "2026-09-23",
  };

  it("no hace falta si ya se descargó desde esa fecha o antes", () => {
    expect(needsBackfill(done, "2026-03-02")).toBe(false);
    expect(needsBackfill(done, "2026-04-01")).toBe(false);
  });

  it.each([
    ["nunca se descargó", { historyBackfilledAt: null }, "2026-03-02"],
    ["quedó pendiente sin history_from", { historyFrom: null }, "2026-03-02"],
    ["una transacción nueva pide fechas anteriores", {}, "2026-01-08"],
  ])("hace falta si %s", (_label, patch, start) => {
    expect(needsBackfill({ ...done, ...patch }, start)).toBe(true);
  });
});

describe("runMarketJob: backfill inicial e incremental", () => {
  it("descarga el historial desde la primera transacción, guarda todo y deja el registro", async () => {
    const { market, store, run, add } = setup();
    add("VOO");

    const result = await run();

    expect(result.status).toBe("ok");
    expect(result.issues).toEqual([]);
    expect(market.calls.history).toEqual([
      { symbol: "VOO", from: FIVE_YEARS, to: "2026-09-25" },
    ]);
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), FIVE_YEARS),
    );
    const voo = store.instruments.get(store.idOf("VOO"));
    expect(voo?.historyFrom).toBe(FIVE_YEARS);
    expect(voo?.historyBackfilledAt).toBe(NOW.toISOString());
    expect(result.summary).toMatchObject({
      job: "daily-prices",
      provider: "fake",
      instruments: 1,
      backfilled: 1,
      rebackfilled: 0,
      incremental: 0,
      failed: 0,
      skippedForBudget: 0,
      quotesUpdated: 1,
    });
    expect(result.summary.barsWritten).toBe(store.closesOf("VOO").length);
    expect(store.quotes.get(store.idOf("VOO"))?.symbol).toBe("VOO");
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      job: "daily-prices",
      status: "ok",
      startedAt: NOW,
    });
    expect(store.runs[0]?.finished?.summary).toEqual(result.summary);
  });

  it("una segunda corrida es incremental e idempotente: no cambia nada", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    const before = marketState(store);

    const second = await run();

    expect(second.status).toBe("ok");
    expect(second.summary).toMatchObject({
      backfilled: 0,
      incremental: 1,
      rebackfilled: 0,
    });
    // Ventana incremental: desde el último precio (2026-09-23) menos 7 días.
    expect(market.calls.history.at(-1)).toEqual({
      symbol: "VOO",
      from: "2026-09-16",
      to: "2026-09-25",
    });
    expect(marketState(store)).toBe(before);
  });

  it("al día siguiente agrega solo la rueda nueva", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    const before = store.closesOf("VOO");
    market.addBar("VOO", "2026-09-24", "999");

    const next = await run({ now: new Date("2026-09-25T22:00:00.000Z") });

    expect(next.summary).toMatchObject({
      incremental: 1,
      backfilled: 0,
      rebackfilled: 0,
    });
    expect(store.closesOf("VOO")).toEqual([
      ...before,
      { date: "2026-09-24", close: "999", adjClose: "999" },
    ]);
  });

  it("completa huecos: si el cron faltó varios días, la ventana parte del último precio", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    for (const date of ["2026-09-24", "2026-09-25", "2026-09-28"])
      market.addBar("VOO", date, "500");

    await run({ now: new Date("2026-09-29T22:00:00.000Z") });

    expect(market.calls.history.at(-1)?.from).toBe("2026-09-16");
    expect(
      store
        .closesOf("VOO")
        .map((r) => r.date)
        .slice(-4),
    ).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28"]);
  });

  it("un instrumento descargado sin ningún precio vuelve a pedir la ventana completa", async () => {
    const { market, store, run } = setup();
    market.addSeries("NEW", "2026-09-01", "2026-09-23");
    store.addInstrument("NEW", {
      firstTxDate: "2026-09-10",
      historyBackfilledAt: "2026-09-10T00:00:00.000Z",
      historyFrom: FIVE_YEARS,
    });

    await run();

    expect(market.calls.history).toEqual([
      { symbol: "NEW", from: FIVE_YEARS, to: "2026-09-25" },
    ]);
    expect(store.closesOf("NEW").length).toBeGreaterThan(0);
  });

  it("sin instrumentos activos no consulta nada y registra la corrida", async () => {
    const { market, store, run } = setup();
    store.addInstrument("HUERFANO"); // sin transacciones ni watchlist
    const result = await run();
    expect(result.status).toBe("ok");
    expect(result.summary.instruments).toBe(0);
    expect(market.calls).toEqual({ history: [], quotes: [], profile: [] });
    expect(store.runs).toHaveLength(1);
  });

  it("usa el símbolo del proveedor cuando difiere del canónico", async () => {
    const { market, store, run } = setup();
    market.addSeries("BRK-B", SERIES_FROM, SERIES_TO);
    store.addInstrument("BRKB", {
      firstTxDate: "2026-03-09",
      providerSymbol: "BRK-B",
    });

    const result = await run();

    expect(market.calls.history[0]?.symbol).toBe("BRK-B");
    expect(market.calls.quotes).toEqual([["BRK-B"]]);
    expect(result.summary.quotesUpdated).toBe(1);
    // La cotización queda asociada al instrumento canónico.
    expect(store.quotes.get(store.idOf("BRKB"))).toBeDefined();
  });
});

describe("runMarketJob: ventana de historial", () => {
  it("una compra reciente igual guarda 5 años de historial (lo usa «Antes de comprar»)", async () => {
    const { market, store, run } = setup();
    market.addSeries("VOO", "2020-01-01", SERIES_TO);
    store.addInstrument("VOO", { firstTxDate: "2026-03-09" });

    await run();

    expect(market.calls.history[0]?.from).toBe(FIVE_YEARS);
    expect(store.closesOf("VOO")[0]?.date).toBe(FIVE_YEARS);
  });

  it("una transacción más vieja que el historial guardado lo extiende hacia atrás", async () => {
    const { market, store, run } = setup();
    market.addSeries("VOO", "2020-01-01", SERIES_TO);
    const voo = store.addInstrument("VOO", { firstTxDate: "2026-03-09" });
    await run();
    expect(store.closesOf("VOO")[0]?.date).toBe(FIVE_YEARS);

    voo.firstTxDate = "2020-06-15"; // el usuario cargó una compra de hace más de 5 años

    const result = await run();

    expect(result.summary).toMatchObject({ backfilled: 1, incremental: 0 });
    expect(market.calls.history.at(-1)).toEqual({
      symbol: "VOO",
      from: "2020-06-08",
      to: "2026-09-25",
    });
    expect(voo.historyFrom).toBe("2020-06-08");
    expect(store.closesOf("VOO")[0]?.date).toBe("2020-06-08");
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), "2020-06-08"),
    );
  });

  it("solo watchlist: 5 años de historial, y al día siguiente no se vuelve a bajar todo", async () => {
    const { market, store, run } = setup();
    market.addSeries("QQQ", "2021-01-01", SERIES_TO);
    const qqq = store.addInstrument("QQQ", { inWatchlist: true });

    await run();

    expect(market.calls.history[0]).toEqual({
      symbol: "QQQ",
      from: "2021-09-24",
      to: "2026-09-25",
    });
    expect(qqq.historyFrom).toBe("2021-09-24");

    // La ventana de "5 años" se corre un día, pero eso no es pedir historial más viejo.
    const next = await run({ now: new Date("2026-09-25T22:00:00.000Z") });
    expect(next.summary).toMatchObject({ backfilled: 0, incremental: 1 });
    expect(market.calls.history.at(-1)?.from).toBe("2026-09-16");
  });

  it("con transacciones y watchlist toma la fecha más antigua", async () => {
    const { market, store, run } = setup();
    market.addSeries("VOO", "2021-01-01", SERIES_TO);
    store.addInstrument("VOO", {
      firstTxDate: "2026-03-09",
      inWatchlist: true,
    });
    await run();
    expect(market.calls.history[0]?.from).toBe("2021-09-24");
  });
});

describe("runMarketJob: splits, dividendos y correcciones", () => {
  it("un split nuevo reajusta hacia atrás: se detecta y se vuelve a bajar todo el historial", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    const before = store.closesOf("VOO");
    const oldClose = before.find((r) => r.date === "2026-03-09")?.close;
    expect(oldClose).toBeDefined();

    market.addBar("VOO", "2026-09-24", "150");
    market.split("VOO", "2026-09-24", 10);
    store.log.length = 0;

    const result = await run();

    expect(result.status).toBe("ok");
    expect(result.summary).toMatchObject({
      rebackfilled: 1,
      incremental: 0,
      backfilled: 0,
    });
    // Nada quedó en la escala vieja: lo guardado es exactamente lo que Yahoo devuelve hoy.
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), FIVE_YEARS),
    );
    expect(
      store.closesOf("VOO").find((r) => r.date === "2026-03-09")?.close,
    ).toBe(new D(oldClose as string).div(10).toFixed());
    expect(store.actionsOf("VOO")).toEqual([
      { type: "SPLIT", exDate: "2026-09-24", ratio: "10" },
    ]);
    // Ventana incremental primero y después la descarga completa desde el mismo inicio.
    expect(market.calls.history.slice(-2)).toEqual([
      { symbol: "VOO", from: "2026-09-16", to: "2026-09-25" },
      { symbol: "VOO", from: FIVE_YEARS, to: "2026-09-25" },
    ]);
    // El instrumento queda "pendiente" y recién al final se marca como descargado.
    const marks = store.log.filter((l) => l.startsWith("mark"));
    expect(marks).toEqual([
      "markNeedsBackfill VOO",
      `markBackfilled VOO ${FIVE_YEARS}`,
    ]);
  });

  it("después del split la corrida siguiente es incremental (no re-descarga en bucle)", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    market.addBar("VOO", "2026-09-24", "150");
    market.split("VOO", "2026-09-24", 10);
    await run();
    const settled = marketState(store);

    const again = await run();

    expect(again.summary).toMatchObject({ rebackfilled: 0, incremental: 1 });
    expect(marketState(store)).toBe(settled);
  });

  it("un split inverso también se detecta (1:10 → ratio 0.1)", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    market.addBar("VOO", "2026-09-24", "1500");
    market.split("VOO", "2026-09-24", 0.1);
    await run();
    expect(store.actionsOf("VOO")).toEqual([
      { type: "SPLIT", exDate: "2026-09-24", ratio: "0.1" },
    ]);
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), FIVE_YEARS),
    );
  });

  it("un dividendo nuevo no cambia el cierre pero sí adj_close: también dispara la re-descarga", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    const adjBefore = store
      .closesOf("VOO")
      .find((r) => r.date === "2026-03-09")?.adjClose;

    market.addBar("VOO", "2026-09-24", "150");
    market.dividend("VOO", "2026-09-24", "1.5");
    const result = await run();

    expect(result.summary.rebackfilled).toBe(1);
    expect(store.actionsOf("VOO")).toEqual([
      { type: "DIVIDEND", exDate: "2026-09-24", amount: "1.5" },
    ]);
    const adjAfter = store
      .closesOf("VOO")
      .find((r) => r.date === "2026-03-09")?.adjClose;
    expect(adjAfter).toBe(new D(adjBefore as string).times("0.99").toFixed());
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), FIVE_YEARS),
    );
  });

  it("una corrección chica de un cierre (dentro de la tolerancia) solo actualiza esa fila", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    const target = market.snapshot("VOO").find((r) => r.date === "2026-09-22");
    const nudged = new D(target?.close as string)
      .times("1.0005")
      .toDecimalPlaces(6)
      .toFixed();
    // 0,05 % < 0,1 % de tolerancia.
    expect(new D("0.0005").lt(ADJUST_TOLERANCE)).toBe(true);
    market.setClose("VOO", "2026-09-22", nudged);

    const result = await run();

    expect(result.summary).toMatchObject({ incremental: 1, rebackfilled: 0 });
    expect(
      store.closesOf("VOO").find((r) => r.date === "2026-09-22")?.close,
    ).toBe(nudged);
  });

  it("una diferencia mayor a la tolerancia se toma como reajuste y re-descarga", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    const target = market.snapshot("VOO").find((r) => r.date === "2026-09-22");
    market.setClose(
      "VOO",
      "2026-09-22",
      new D(target?.close as string)
        .times("1.002")
        .toDecimalPlaces(6)
        .toFixed(),
    );

    const result = await run();

    expect(result.summary.rebackfilled).toBe(1);
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), FIVE_YEARS),
    );
  });

  it("al re-descargar poda las filas que Yahoo ya no devuelve (quedaron en la escala vieja)", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    // Yahoo pasa a devolver la rueda del 2026-06-15 sin cierre (null) tras el split.
    market.addBar("VOO", "2026-09-24", "150");
    market.split("VOO", "2026-09-24", 10);
    market.deleteBar("VOO", "2026-06-15");
    expect(store.closesOf("VOO").some((r) => r.date === "2026-06-15")).toBe(
      true,
    );

    await run();

    expect(store.closesOf("VOO").some((r) => r.date === "2026-06-15")).toBe(
      false,
    );
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), FIVE_YEARS),
    );
  });

  it("re-descarga desde el history_from viejo si era anterior al inicio actual", async () => {
    const { market, store, run } = setup();
    market.addSeries("QQQ", "2021-01-01", SERIES_TO);
    store.addInstrument("QQQ", { inWatchlist: true });
    await run(); // history_from = 2021-09-24
    market.addBar("QQQ", "2026-09-24", "150");
    market.split("QQQ", "2026-09-24", 2);

    // Un mes después: el inicio "5 años atrás" se corrió, pero lo guardado llega hasta 2021-09-24.
    await run({ now: new Date("2026-10-24T22:00:00.000Z") });

    expect(market.calls.history.at(-1)?.from).toBe("2021-09-24");
    expect(store.closesOf("QQQ")).toEqual(
      only(market.snapshot("QQQ"), "2021-09-24"),
    );
  });

  it("un split no detectado a tiempo (corrida perdida de varios días) se ve igual", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    market.addBar("VOO", "2026-09-24", "150");
    market.split("VOO", "2026-09-24", 10);
    for (const date of ["2026-09-25", "2026-09-28", "2026-09-29"])
      market.addBar("VOO", date, "151");

    // Recién se corre el cron el 30/09: la ventana parte del último precio guardado, no de hoy.
    await run({ now: new Date("2026-09-30T22:00:00.000Z") });

    expect(store.actionsOf("VOO")).toEqual([
      { type: "SPLIT", exDate: "2026-09-24", ratio: "10" },
    ]);
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), FIVE_YEARS),
    );
  });

  it("si el presupuesto se agotó, el reajuste queda pendiente para la próxima corrida", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    market.addBar("VOO", "2026-09-24", "150");
    market.split("VOO", "2026-09-24", 10);

    // Reloj que salta 100 ms por lectura y un presupuesto que alcanza para arrancar el instrumento
    // pero no para el re-backfill.
    let t = 0;
    const clock = () => (t += 100);
    const first = await run({ budgetMs: 150, clock });

    expect(first.summary.rebackfilled).toBe(0);
    expect(
      first.issues.some((i) => i.stage === "backfill" && i.symbol === "VOO"),
    ).toBe(true);
    expect(first.status).toBe("partial");
    expect(
      store.instruments.get(store.idOf("VOO"))?.historyBackfilledAt,
    ).toBeNull();

    // La próxima corrida lo ve pendiente y lo baja completo.
    const next = await run();
    expect(next.summary.backfilled).toBe(1);
    expect(store.closesOf("VOO")).toEqual(
      only(market.snapshot("VOO"), FIVE_YEARS),
    );
    expect(next.status).toBe("ok");
  });
});

describe("runMarketJob: fallos y presupuesto", () => {
  it("un instrumento que falla no frena a los demás; queda pendiente y se recupera después", async () => {
    const { market, store, run, add } = setup();
    add("AAA");
    add("BBB");
    add("CCC");
    market.failHistory("BBB");

    const result = await run();

    expect(result.status).toBe("partial");
    expect(result.summary).toMatchObject({
      failed: 1,
      backfilled: 2,
      quotesUpdated: 3,
    });
    expect(result.issues).toEqual([
      { stage: "backfill", symbol: "BBB", message: "UNAVAILABLE: caído" },
    ]);
    expect(store.closesOf("AAA").length).toBeGreaterThan(0);
    expect(store.closesOf("CCC").length).toBeGreaterThan(0);
    expect(store.closesOf("BBB")).toEqual([]);
    expect(
      store.instruments.get(store.idOf("BBB"))?.historyBackfilledAt,
    ).toBeNull();

    market.recoverHistory("BBB");
    const retry = await run();
    expect(retry.status).toBe("ok");
    expect(retry.summary).toMatchObject({
      backfilled: 1,
      incremental: 2,
      failed: 0,
    });
    expect(store.closesOf("BBB")).toEqual(
      only(market.snapshot("BBB"), FIVE_YEARS),
    );
  });

  it("un fallo en la ventana incremental se informa como 'prices'", async () => {
    const { market, store, run, add } = setup();
    add("AAA");
    await run();
    market.failHistory("AAA");
    const result = await run();
    expect(result.status).toBe("error");
    expect(result.issues[0]).toMatchObject({ stage: "prices", symbol: "AAA" });
    expect(
      store.instruments.get(store.idOf("AAA"))?.historyBackfilledAt,
    ).not.toBeNull();
  });

  it("si fallan todos, la corrida es 'error'", async () => {
    const { market, store, run, add } = setup();
    add("AAA");
    add("BBB");
    market.failHistory("AAA");
    market.failHistory("BBB");
    const result = await run();
    expect(result.status).toBe("error");
    expect(store.runs[0]?.status).toBe("error");
    expect(result.summary.failed).toBe(2);
  });

  it("sin transitorios: un símbolo desconocido (NOT_FOUND) queda registrado con su tipo", async () => {
    const { store, run } = setup();
    store.addInstrument("FANTASMA", { firstTxDate: "2026-03-09" });
    const result = await run();
    expect(result.issues[0]).toMatchObject({
      stage: "backfill",
      symbol: "FANTASMA",
      message: expect.stringContaining("NOT_FOUND"),
    });
  });

  it("respeta el presupuesto: no arranca instrumentos nuevos y lo informa", async () => {
    const { market, store, run, add } = setup();
    for (const symbol of ["A", "B", "C", "D"]) add(symbol);
    // Cada lectura del reloj suma 100 ms; con 250 ms de presupuesto entran dos instrumentos.
    let t = 0;
    const clock = () => (t += 100);

    const result = await run({ budgetMs: 250, clock });

    expect(market.calls.history.map((c) => c.symbol)).toEqual(["A", "B"]);
    expect(result.summary).toMatchObject({
      backfilled: 2,
      skippedForBudget: 2,
    });
    expect(result.status).toBe("partial");
    expect(result.issues).toContainEqual({
      stage: "run",
      message: "presupuesto de tiempo agotado: quedan 2 instrumentos",
    });
    expect(store.closesOf("C")).toEqual([]);
  });

  it("los pendientes van primero, así que un presupuesto corto no deja sin historial a los nuevos", async () => {
    const { market, store, run, add } = setup();
    add("X"); // ya sincronizado
    await run();
    add("Y"); // instrumento nuevo, sin historial
    market.calls.history.length = 0;

    let t = 0;
    await run({ budgetMs: 150, clock: () => (t += 100) });

    expect(market.calls.history.map((c) => c.symbol)).toEqual(["Y"]);
    expect(store.closesOf("Y").length).toBeGreaterThan(0);
  });

  it("no toca nada más allá de lo pendiente en el job 'backfill'", async () => {
    const { market, store, run, add } = setup();
    add("OLD");
    await run();
    add("NEW");
    market.calls.history.length = 0;
    market.calls.quotes.length = 0;
    store.quotes.clear();

    const result = await run({ job: "backfill" });

    expect(market.calls.history.map((c) => c.symbol)).toEqual(["NEW"]);
    expect(market.calls.quotes).toEqual([["NEW"]]);
    expect(result.summary).toMatchObject({
      job: "backfill",
      instruments: 2,
      backfilled: 1,
      incremental: 0,
      quotesUpdated: 1,
    });
    expect([...store.quotes.keys()]).toEqual([store.idOf("NEW")]);
    expect(store.runs.at(-1)?.job).toBe("backfill");
  });

  it("el job 'backfill' sin pendientes no hace nada", async () => {
    const { market, run, add } = setup();
    add("OLD");
    await run();
    market.calls.history.length = 0;
    market.calls.quotes.length = 0;
    const result = await run({ job: "backfill" });
    expect(result.status).toBe("ok");
    expect(market.calls.history).toEqual([]);
    expect(market.calls.quotes).toEqual([]);
  });

  it("una respuesta vacía en un backfill no poda el historial guardado", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    await run();
    const stored = store.closesOf("VOO");
    // Yahoo devuelve una ventana sin datos (p. ej. una falla rara del proveedor).
    market.addSeries("VOO", "2030-01-01", "2030-01-05");
    await store.markNeedsBackfill(store.idOf("VOO"));
    store.log.length = 0;

    const result = await run();

    expect(store.closesOf("VOO")).toEqual(stored);
    expect(store.log.some((l) => l.startsWith("prune"))).toBe(false);
    expect(result.summary.backfilled).toBe(1);
  });

  it("acota el detalle guardado a 50 entradas y avisa cuántas faltan", async () => {
    const { store, run } = setup();
    for (let i = 0; i < 60; i++)
      store.addInstrument(`S${i}`, { firstTxDate: "2026-03-09" });

    const result = await run();

    expect(result.issues.length).toBeGreaterThan(100);
    const saved = store.runs[0]?.finished?.issues ?? [];
    expect(saved).toHaveLength(51);
    expect(saved.at(-1)?.message).toMatch(/^…y \d+ más$/);
  });
});

describe("runMarketJob: cotizaciones", () => {
  it("un símbolo sin cotización se informa, y el resto se actualiza", async () => {
    const { market, store, run, add } = setup();
    add("AAA");
    add("BBB");
    market.removeQuote("BBB");

    const result = await run();

    expect(result.summary.quotesUpdated).toBe(1);
    expect(result.status).toBe("partial");
    expect(result.issues).toEqual([
      {
        stage: "quotes",
        symbol: "BBB",
        message: expect.stringContaining("sin cotización"),
      },
    ]);
    expect([...store.quotes.keys()]).toEqual([store.idOf("AAA")]);
  });

  it("si falla la consulta de cotizaciones, los precios diarios igual se guardan", async () => {
    const { market, store, run, add } = setup();
    add("AAA");
    market.failQuotes();

    const result = await run();

    expect(result.status).toBe("partial");
    expect(result.issues[0]).toMatchObject({ stage: "quotes" });
    expect(store.closesOf("AAA").length).toBeGreaterThan(0);
  });

  it("ignora cotizaciones de símbolos que no se pidieron y repetidas", async () => {
    const { store } = setup();
    const aaa = store.addInstrument("AAA", { firstTxDate: "2026-03-09" });
    const active = (await store.listActiveInstruments()).filter(
      (i) => i.id === aaa.id,
    );
    const quote = (symbol: string, price: string) => ({
      symbol,
      price,
      change: null,
      changePct: null,
      asOf: NOW,
      currency: "USD",
    });
    const provider = {
      name: "x",
      search: async () => [],
      getDailyHistory: async () => ({ bars: [], actions: [], droppedBars: 0 }),
      getQuotes: async () => [
        quote("AAA", "10"),
        quote("aaa", "11"),
        quote("OTRO", "99"),
      ],
    };

    const result = await refreshQuotes({
      provider,
      store,
      instruments: active,
    });

    expect(result).toEqual({ updated: 1, missing: [] });
    expect(store.quotes.get(aaa.id)?.price).toBe("10");
  });

  it("sin instrumentos no consulta", async () => {
    const { market, store } = setup();
    expect(
      await refreshQuotes({ provider: market, store, instruments: [] }),
    ).toEqual({
      updated: 0,
      missing: [],
    });
    expect(market.calls.quotes).toEqual([]);
  });
});

describe("runMarketJob: perfil", () => {
  it("completa el perfil solo en el backfill y solo los campos vacíos", async () => {
    const { market, store, run } = setup();
    market.addSeries("VOO", SERIES_FROM, SERIES_TO);
    const voo = store.addInstrument("VOO", {
      firstTxDate: "2026-03-09",
      profile: { name: "Vanguard S&P 500 ETF" },
    });

    await run();
    await run();

    expect(market.calls.profile).toEqual(["VOO"]); // una sola vez, no en la incremental
    expect(voo.profile).toEqual({
      name: "Vanguard S&P 500 ETF", // el existente no se pisa
      type: "STOCK",
      exchange: "NasdaqGS",
      sector: "Tech",
      industry: "Software",
    });
  });

  it("un fallo del perfil es cosmético: se registra pero la corrida sigue 'ok'", async () => {
    const { market, run, add } = setup();
    add("VOO");
    market.setProfile(
      "VOO",
      new MarketDataError("UNAVAILABLE", "caído", { symbol: "VOO" }),
    );

    const result = await run();

    expect(result.status).toBe("ok");
    expect(result.issues).toEqual([
      {
        stage: "profile",
        symbol: "VOO",
        message: expect.stringContaining("UNAVAILABLE"),
      },
    ]);
    expect(result.summary.backfilled).toBe(1);
  });
});

describe("runMarketJob: registro de corridas", () => {
  it("cierra como 'error' las corridas que quedaron 'running' hace más de 15 minutos", async () => {
    const { store, run } = setup();
    store.runs.push(
      {
        id: "vieja",
        job: "daily-prices",
        startedAt: new Date(NOW.getTime() - 20 * 60_000),
        status: "running",
      },
      {
        id: "reciente",
        job: "daily-prices",
        startedAt: new Date(NOW.getTime() - 5 * 60_000),
        status: "running",
      },
    );

    await run();

    expect(store.runs.find((r) => r.id === "vieja")?.status).toBe("error");
    expect(store.runs.find((r) => r.id === "reciente")?.status).toBe("running");
  });

  it("si falla al abrir el registro, igual corre y lo informa (corrida parcial)", async () => {
    const { store, run, add } = setup();
    add("VOO");
    store.failOn("startRun");

    const result = await run();

    expect(result.runId).toBeNull();
    expect(result.status).toBe("partial");
    expect(result.issues[0]).toMatchObject({
      stage: "run",
      message: expect.stringContaining("registro"),
    });
    expect(store.closesOf("VOO").length).toBeGreaterThan(0);
  });

  it("si falla al cerrar el registro, devuelve igual el resultado", async () => {
    const { store, run, add } = setup();
    add("VOO");
    store.failOn("finishRun");
    const result = await run();
    expect(result.summary.backfilled).toBe(1);
    expect(result.issues.at(-1)).toMatchObject({ stage: "run" });
  });

  it("si no se pueden listar los instrumentos, es 'error' y queda cerrado", async () => {
    const { store, run } = setup();
    store.failOn("listActiveInstruments", new Error("db caída"));
    const result = await run();
    expect(result.status).toBe("error");
    expect(store.runs[0]?.status).toBe("error");
    expect(store.runs[0]?.finished?.issues[0]).toMatchObject({
      stage: "run",
      message: "Error: db caída",
    });
  });

  it("nunca lanza, aunque el proveedor y la base fallen a la vez", async () => {
    const { market, store, run, add } = setup();
    add("VOO");
    market.failHistory("VOO");
    store.failOn("startRun");
    store.failOn("finishRun");
    await expect(run()).resolves.toMatchObject({ status: "error" });
  });
});
