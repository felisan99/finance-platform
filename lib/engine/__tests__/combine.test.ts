import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { combineEngineResults, combineSeries } from "../combine";
import { d, type Dec } from "../decimal";
import { computeEngine } from "../engine";
import { computePerformance, performanceOfSeries } from "../performance";
import { computeTwr } from "../returns";
import { buildDailySeries, type DailySeries } from "../series";
import type { Transaction } from "../types";
import type { DailyClose } from "../valuation";
import { buy, deposit, dividend, sell, split, withdrawal } from "./helpers";

// Calendario (setiembre de 2026): lun 21, mar 22, mié 23, jue 24, vie 25, lun 28. Las operaciones
// van a las 15:00Z (11:00 en Nueva York): caen en su día.
const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T15:00:00Z`;

/** Las operaciones de otra cuenta (el motor exige una sola cuenta por llamada). */
const inAccount = <T extends Transaction>(account: string, txs: T[]): T[] =>
  txs.map((tx) => ({ ...tx, accountId: account }));

const closes = (
  spec: Record<string, ReadonlyArray<readonly [number, string]>>,
): Map<string, DailyClose[]> =>
  new Map(
    Object.entries(spec).map(([symbol, rows]) => [
      symbol,
      rows.map(([day, close]) => ({
        date: `2026-09-${String(day).padStart(2, "0")}`,
        close: d(close),
      })),
    ]),
  );

const text = (value: Dec | null) => value?.toFixed() ?? null;

/** Una serie en texto, para comparar con `toEqual` sin depender de la representación interna. */
const plain = (series: DailySeries) => ({
  baseDate: series.baseDate,
  unpricedSymbols: series.unpricedSymbols,
  noBaseDays: series.noBaseDays,
  points: series.points.map((p) => ({
    date: p.date,
    value: p.value.toFixed(),
    cash: p.cash.toFixed(),
    marketValue: p.marketValue.toFixed(),
    flow: p.flow.toFixed(),
    growth: text(p.growth),
    unpriced: p.unpriced,
  })),
});

describe("combineEngineResults", () => {
  // A: deposita 1000, compra 10 VOO a 100 y vende 5 a 120 (realiza 100; quedan 5 a costo 500).
  // B: deposita 600 y compra 5 VOO a 110 con 1 de comisión (costo 551, efectivo 49).
  const a = computeEngine(
    inAccount("A", [
      deposit(at(21), "1000"),
      buy(at(21), "VOO", "10", "100"),
      sell(at(22), "VOO", "5", "120"),
    ]),
  );
  const b = computeEngine(
    inAccount("B", [
      deposit(at(21), "600"),
      buy(at(22), "VOO", "5", "110", "1"),
    ]),
  );

  it("suma cantidades, costos, realizado y efectivo; el costo promedio es el de la suma", () => {
    const all = combineEngineResults([a, b]);
    const voo = all.positions.find((p) => p.symbol === "VOO")!;
    expect(text(voo.quantity)).toBe("10");
    expect(text(voo.costBasis)).toBe("1051");
    expect(text(voo.avgCost)).toBe("105.1");
    expect(text(voo.realizedPnl)).toBe("100");
    expect(voo.isOpen).toBe(true);
    expect(text(all.cash)).toBe("649"); // 600 de A (1000 − 1000 + 600) + 49 de B
    expect(text(all.totals.deposits)).toBe("1600");
    expect(text(all.totals.openCostBasis)).toBe("1051");
    expect(text(all.totals.realizedPnl)).toBe("100");
    expect(all.issues).toEqual([]);
  });

  it("no es lo mismo que mezclar las operaciones: el costo promedio es por cuenta", () => {
    // A compra 10 a 100 y vende 5 a 150 (realiza 250). B compra 10 a 200 antes de esa venta.
    const txA = inAccount("A", [
      deposit(at(21), "1000"),
      buy(at(21), "VOO", "10", "100"),
      sell(at(23), "VOO", "5", "150"),
    ]);
    const txB = inAccount("B", [
      deposit(at(21), "2000"),
      buy(at(22), "VOO", "10", "200"),
    ]);
    const combined = combineEngineResults([
      computeEngine(txA),
      computeEngine(txB),
    ]);
    expect(text(combined.totals.realizedPnl)).toBe("250");
    // Mezcladas, la venta de A se habría costeado con el promedio de las dos (150): realizado 0.
    const mixed = computeEngine(inAccount("X", [...txA, ...txB]));
    expect(text(mixed.totals.realizedPnl)).toBe("0");
    // La cantidad y el costo base que quedan abiertos coinciden igual: 15 a 2500.
    const voo = combined.positions[0]!;
    expect([text(voo.quantity), text(voo.costBasis)]).toEqual(["15", "2500"]);
  });

  it("los dividendos del mismo símbolo se suman, y también su total", () => {
    const x = computeEngine(
      inAccount("X", [
        deposit(at(21), "1000"),
        buy(at(21), "VOO", "1", "100"),
        dividend(at(22), "VOO", "3.5"),
      ]),
    );
    const y = computeEngine(
      inAccount("Y", [
        deposit(at(21), "1000"),
        buy(at(21), "VOO", "2", "100"),
        dividend(at(22), "VOO", "7"),
      ]),
    );
    const all = combineEngineResults([x, y]);
    expect(text(all.positions[0]!.dividends)).toBe("10.5");
    expect(text(all.totals.dividends)).toBe("10.5");
  });

  it("un símbolo cerrado en una cuenta y abierto en otra queda abierto; cerrado en todas, cerrado", () => {
    const closed = computeEngine(
      inAccount("C", [
        deposit(at(21), "1000"),
        buy(at(21), "AAPL", "2", "100"),
        sell(at(22), "AAPL", "2", "90"),
      ]),
    );
    const open = computeEngine(
      inAccount("D", [deposit(at(21), "500"), buy(at(21), "AAPL", "1", "150")]),
    );
    const mixed = combineEngineResults([closed, open]);
    const aapl = mixed.positions.find((p) => p.symbol === "AAPL")!;
    expect(aapl.isOpen).toBe(true);
    expect(text(aapl.avgCost)).toBe("150");
    expect(text(aapl.realizedPnl)).toBe("-20");

    const bothClosed = combineEngineResults([closed, closed]);
    const gone = bothClosed.positions.find((p) => p.symbol === "AAPL")!;
    expect(gone.isOpen).toBe(false);
    expect(gone.avgCost).toBeNull();
    expect(text(gone.realizedPnl)).toBe("-40");
  });

  it("posiciones ordenadas por símbolo, sin repetir", () => {
    const x = computeEngine(
      inAccount("X", [
        deposit(at(21), "1000"),
        buy(at(21), "MSFT", "1", "1"),
        buy(at(21), "AAPL", "1", "1"),
      ]),
    );
    const y = computeEngine(
      inAccount("Y", [deposit(at(21), "1000"), buy(at(21), "BRK-B", "1", "1")]),
    );
    expect(combineEngineResults([x, y]).positions.map((p) => p.symbol)).toEqual(
      ["AAPL", "BRK-B", "MSFT"],
    );
  });

  it("el efectivo negativo se mira sobre el total; las demás observaciones se conservan", () => {
    const negative = computeEngine(
      inAccount("N", [deposit(at(21), "50"), buy(at(21), "VOO", "1", "100")]),
    );
    expect(negative.issues.map((i) => i.code)).toEqual(["NEGATIVE_CASH"]);
    const rich = computeEngine(inAccount("R", [deposit(at(21), "100")]));
    expect(combineEngineResults([negative, rich]).issues).toEqual([]);

    const poor = computeEngine(inAccount("P", [deposit(at(21), "20")]));
    const stillNegative = combineEngineResults([negative, poor]);
    expect(stillNegative.issues).toHaveLength(1);
    expect(stillNegative.issues[0]).toMatchObject({ code: "NEGATIVE_CASH" });
    expect(text((stillNegative.issues[0] as { cash: Dec }).cash)).toBe("-30");

    const broken = computeEngine(
      inAccount("S", [deposit(at(21), "10"), sell(at(21), "TSLA", "1", "5")]),
    );
    expect(
      combineEngineResults([broken, rich]).issues.map((i) => i.code),
    ).toEqual(["SELL_EXCEEDS_HOLDINGS"]);
  });

  it("una sola cuenta queda igual; ninguna, vacía", () => {
    const one = combineEngineResults([a]);
    expect(
      one.positions.map((p) => [p.symbol, text(p.quantity), text(p.avgCost)]),
    ).toEqual(
      a.positions.map((p) => [p.symbol, text(p.quantity), text(p.avgCost)]),
    );
    expect(text(one.cash)).toBe(text(a.cash));
    const none = combineEngineResults([]);
    expect(none.positions).toEqual([]);
    expect(text(none.cash)).toBe("0");
    expect(text(none.totals.deposits)).toBe("0");
  });
});

describe("combineSeries", () => {
  const vooCloses = closes({
    VOO: [
      [21, "100"],
      [22, "110"],
      [23, "110"],
      [24, "121"],
      [25, "121"],
    ],
  });
  // A: lun deposita 1000 y compra 10 VOO a 100. B: arranca el miércoles con 500 en efectivo.
  const a = buildDailySeries({
    transactions: inAccount("A", [
      deposit(at(21), "1000"),
      buy(at(21), "VOO", "10", "100"),
    ]),
    closes: vooCloses,
    endDate: "2026-09-24",
  });
  const b = buildDailySeries({
    transactions: inAccount("B", [deposit(at(23), "500")]),
    closes: vooCloses,
    endDate: "2026-09-24",
  });

  it("suma día por día; antes de empezar, una cuenta suma 0; el crecimiento sale de los totales", () => {
    const all = combineSeries([a, b]);
    expect(all.baseDate).toBe("2026-09-18");
    expect(
      all.points.map((p) => [
        p.date,
        text(p.value),
        text(p.flow),
        text(p.growth),
      ]),
    ).toEqual([
      ["2026-09-21", "1000", "1000", "1"],
      ["2026-09-22", "1100", "0", "1.1"],
      ["2026-09-23", "1600", "500", "1"], // 1100 + 500, base 1100 + 500
      ["2026-09-24", "1710", "0", "1.06875"], // 1210 + 500 sobre 1600
    ]);
    // El TWR de la cartera entera: 1,1 × 1,06875 − 1 (no el promedio de los de cada cuenta).
    expect(text(computeTwr(all.points, "2026-09-18", "2026-09-24").twr)).toBe(
      "0.175625",
    );
    expect(all.noBaseDays).toBe(0);
  });

  it("con una sola serie devuelve exactamente la misma, y las vacías no cuentan", () => {
    const empty = buildDailySeries({
      transactions: [],
      closes: vooCloses,
      endDate: "2026-09-24",
    });
    expect(plain(combineSeries([a]))).toEqual(plain(a));
    expect(plain(combineSeries([a, empty]))).toEqual(plain(a));
    expect(plain(combineSeries([empty]))).toEqual(plain(empty));
    expect(combineSeries([])).toEqual({
      points: [],
      baseDate: null,
      unpricedSymbols: [],
      noBaseDays: 0,
    });
  });

  it("un split cargado en cada cuenta se aplica una vez por cuenta (mezclar las operaciones lo duplicaría)", () => {
    // Cada cuenta tiene 10 X y carga el split 2:1 del miércoles; los cierres guardados ya están
    // ajustados (50 antes y después).
    const xCloses = closes({
      X: [
        [21, "50"],
        [22, "50"],
        [23, "50"],
        [24, "50"],
      ],
    });
    const each = (account: string) =>
      inAccount(account, [
        deposit(at(21), "1000"),
        buy(at(21), "X", "10", "100"),
        split(at(23), "X", "2"),
      ]);
    const series = (txs: Transaction[]) =>
      buildDailySeries({
        transactions: txs,
        closes: xCloses,
        endDate: "2026-09-24",
      });
    const combined = combineSeries([series(each("A")), series(each("B"))]);
    expect(combined.points.map((p) => text(p.value))).toEqual([
      "2000",
      "2000",
      "2000",
      "2000",
    ]);
    const mixed = series([...each("A"), ...each("B")]);
    expect(mixed.points.map((p) => text(p.value))).not.toEqual(
      combined.points.map((p) => text(p.value)),
    );
  });

  it("una serie que terminó antes sigue valiendo su último punto, sin flujos", () => {
    const short = buildDailySeries({
      transactions: inAccount("S", [deposit(at(21), "300")]),
      closes: vooCloses,
      endDate: "2026-09-22",
    });
    const all = combineSeries([a, short]);
    expect(
      all.points.map((p) => [p.date, text(p.value), text(p.flow)]),
    ).toEqual([
      ["2026-09-21", "1300", "1300"],
      ["2026-09-22", "1400", "0"],
      ["2026-09-23", "1400", "0"],
      ["2026-09-24", "1510", "0"],
    ]);
  });

  it("junta los símbolos valuados a costo, por día y en total", () => {
    const noPrice = buildDailySeries({
      transactions: inAccount("N", [
        deposit(at(22), "100"),
        buy(at(22), "ZZZ", "1", "100"),
      ]),
      closes: vooCloses,
      endDate: "2026-09-24",
    });
    const all = combineSeries([a, noPrice]);
    expect(all.unpricedSymbols).toEqual(["ZZZ"]);
    expect(all.points.map((p) => p.unpriced)).toEqual([
      [],
      ["ZZZ"],
      ["ZZZ"],
      ["ZZZ"],
    ]);
  });

  it("sin base (todo retirado) el día no aporta retorno y se cuenta", () => {
    const out = buildDailySeries({
      transactions: inAccount("W", [
        deposit(at(21), "100"),
        withdrawal(at(22), "100"),
      ]),
      closes: vooCloses,
      endDate: "2026-09-24",
    });
    const all = combineSeries([out]);
    expect(all.noBaseDays).toBe(out.noBaseDays);
    expect(all.points.map((p) => text(p.growth))).toEqual(
      out.points.map((p) => text(p.growth)),
    );
  });
});

describe("combineSeries: propiedades", () => {
  const DAYS = [21, 22, 23, 24, 25, 28];
  const priceCloses = closes({
    VOO: DAYS.map((day, i) => [day, String(100 + i * 7)] as const),
    QQQ: DAYS.map((day, i) => [day, String(300 - i * 11)] as const),
  });
  const END = "2026-09-28";

  const operation = fc.record({
    day: fc.constantFrom(...DAYS),
    kind: fc.constantFrom("deposit", "buy", "withdraw"),
    symbol: fc.constantFrom("VOO", "QQQ"),
    units: fc.integer({ min: 1, max: 5 }),
    cents: fc.integer({ min: 100, max: 500_000 }),
  });
  const account = (id: string) =>
    fc.array(operation, { minLength: 1, maxLength: 8 }).map((ops) =>
      inAccount(
        id,
        ops.map((op) =>
          op.kind === "deposit"
            ? deposit(at(op.day), (op.cents / 100).toFixed(2))
            : op.kind === "withdraw"
              ? withdrawal(at(op.day), (op.cents / 1000).toFixed(2))
              : buy(at(op.day), op.symbol, String(op.units), "100"),
        ),
      ),
    );
  const seriesOf = (txs: Transaction[]) =>
    buildDailySeries({ transactions: txs, closes: priceCloses, endDate: END });

  it("el valor y los flujos de cada día son la suma de los de cada cuenta", () => {
    fc.assert(
      fc.property(account("A"), account("B"), (ta, tb) => {
        const sa = seriesOf(ta);
        const sb = seriesOf(tb);
        const all = combineSeries([sa, sb]);
        const at = (s: DailySeries, date: string) =>
          s.points.find((p) => p.date === date);
        for (const point of all.points) {
          const pa = at(sa, point.date);
          const pb = at(sb, point.date);
          expect(point.value.toFixed()).toBe(
            (pa?.value ?? d("0")).plus(pb?.value ?? d("0")).toFixed(),
          );
          expect(point.flow.toFixed()).toBe(
            (pa?.flow ?? d("0")).plus(pb?.flow ?? d("0")).toFixed(),
          );
        }
        // El último día, el valor total es la suma de los dos valores finales.
        expect(all.points.at(-1)!.value.toFixed()).toBe(
          sa.points.at(-1)!.value.plus(sb.points.at(-1)!.value).toFixed(),
        );
      }),
      { numRuns: 150 },
    );
  });

  it("dos cuentas idénticas rinden (TWR) lo mismo que una", () => {
    fc.assert(
      fc.property(account("A"), (ta) => {
        const one = seriesOf(ta);
        const twice = combineSeries([one, seriesOf(inAccount("B", ta))]);
        const base = one.baseDate!;
        const single = computeTwr(one.points, base, END).twr;
        const double = computeTwr(twice.points, base, END).twr;
        expect(double?.toDecimalPlaces(20).toFixed() ?? null).toBe(
          single?.toDecimalPlaces(20).toFixed() ?? null,
        );
        expect(twice.noBaseDays).toBe(one.noBaseDays);
      }),
      { numRuns: 150 },
    );
  });

  it("combinar una sola serie no cambia nada", () => {
    fc.assert(
      fc.property(account("A"), (ta) => {
        const one = seriesOf(ta);
        expect(plain(combineSeries([one]))).toEqual(plain(one));
      }),
      { numRuns: 100 },
    );
  });
});

describe("performanceOfSeries", () => {
  it("con la serie de una cuenta da lo mismo que computePerformance", () => {
    const input = {
      transactions: [deposit(at(21), "1000"), buy(at(21), "VOO", "10", "100")],
      closes: closes({
        VOO: [
          [21, "100"],
          [22, "110"],
          [24, "99"],
        ],
      }),
      endDate: "2026-09-24",
      benchmark: [
        { date: "2026-09-18", close: d("400") },
        { date: "2026-09-24", close: d("420") },
      ],
    };
    const direct = computePerformance(input);
    const split = performanceOfSeries(buildDailySeries(input), input.benchmark);
    const periods = (r: typeof direct) =>
      r.periods.map((p) => [
        p.id,
        text(p.twr),
        text(p.gain),
        text(p.benchmarkReturn),
      ]);
    expect(periods(split)).toEqual(periods(direct));
    expect(split.warnings).toEqual(direct.warnings);
  });
});
