import { describe, expect, it } from "vitest";
import { computeEngine, d, valuePortfolio, type PriceInfo } from "@/lib/engine";
import {
  buy,
  cashTx,
  deposit,
  dividend,
  sell,
  withdrawal,
} from "@/lib/engine/__tests__/helpers";
import {
  ACTIVITY_PAGE_SIZE,
  activityQuery,
  groupByDay,
  localRangeToUtc,
  parseActivityFilters,
} from "../activity";
import { buildDashboard } from "../dashboard";
import {
  parsePositionSort,
  sortPositions,
  splitPositions,
} from "../positions-list";

const T = "2026-01-05T15:00:00Z";

const price = (
  value: string,
  previous: string | null,
  asOf = "2026-09-23T20:00:00Z",
): PriceInfo => ({
  price: d(value),
  asOf: new Date(asOf),
  source: "quote",
  previousClose: previous === null ? null : d(previous),
});

/** Cinco posiciones con valor, día y ganancia distintos, más una cerrada y una sin precio. */
function sample() {
  const result = computeEngine([
    deposit(T, "100000"),
    buy(T, "AAA", "10", "100"), // costo 1000
    buy(T, "BBB", "10", "50"), // costo 500
    buy(T, "CCC", "10", "20"), // costo 200
    buy(T, "DDD", "10", "10"), // costo 100
    buy(T, "NOPRICE", "10", "8"), // costo 80
    buy(T, "OLD", "5", "10"),
    sell("2026-02-05T15:00:00Z", "OLD", "5", "14"), // realizado 20
  ]);
  const prices = new Map([
    ["AAA", price("110", "100")], // MV 1100  día +10 %  pnl +100  +10 %
    ["BBB", price("45", "50")], // MV 450   día −10 %  pnl −50   −10 %
    ["CCC", price("30", "25")], // MV 300   día +20 %  pnl +100  +50 %
    ["DDD", price("10", "10")], // MV 100   día 0 %    pnl 0     0 %
  ]);
  return valuePortfolio(result, prices);
}

describe("parsePositionSort", () => {
  it("valores válidos y por defecto", () => {
    expect(parsePositionSort("pnl")).toBe("pnl");
    expect(parsePositionSort(["dayPct", "value"])).toBe("dayPct");
    expect(parsePositionSort(undefined)).toBe("value");
    expect(parsePositionSort("")).toBe("value");
    expect(parsePositionSort("nope")).toBe("value");
    expect(parsePositionSort("__proto__")).toBe("value");
    expect(parsePositionSort("constructor")).toBe("value");
  });
});

describe("sortPositions", () => {
  const open = splitPositions(sample().positions).open;
  const symbols = (sort: Parameters<typeof sortPositions>[1]) =>
    sortPositions(open, sort).map((p) => p.symbol);

  it("por valor: de mayor a menor y, al final, las que no tienen precio (por costo)", () => {
    expect(symbols("value")).toEqual(["AAA", "BBB", "CCC", "DDD", "NOPRICE"]);
  });

  it("por variación del día", () => {
    // CCC +20 %, AAA +10 %, DDD 0 %, BBB −10 %; NOPRICE sin dato, al final.
    expect(symbols("dayPct")).toEqual(["CCC", "AAA", "DDD", "BBB", "NOPRICE"]);
  });

  it("por ganancia en dólares", () => {
    // AAA +100, CCC +100 (empate: por símbolo), DDD 0, BBB −50.
    expect(symbols("pnl")).toEqual(["AAA", "CCC", "DDD", "BBB", "NOPRICE"]);
  });

  it("por ganancia porcentual", () => {
    expect(symbols("pnlPct")).toEqual(["CCC", "AAA", "DDD", "BBB", "NOPRICE"]);
  });

  it("por símbolo, ascendente", () => {
    expect(symbols("symbol")).toEqual(["AAA", "BBB", "CCC", "DDD", "NOPRICE"]);
  });

  it("'hoy' y 'ganancia %' son criterios distintos: el orden cambia según cuál se elija", () => {
    // X: ganó +20 % desde que la compré pero hoy solo +4,3 %. Y: gana +10 % en total pero hoy +22 %.
    const result = computeEngine([
      deposit(T, "10000"),
      buy(T, "X", "10", "10"),
      buy(T, "Y", "10", "10"),
    ]);
    const valued = valuePortfolio(
      result,
      new Map([
        ["X", price("12", "11.5")],
        ["Y", price("11", "9")],
      ]),
    );
    expect(
      sortPositions(valued.positions, "dayPct").map((p) => p.symbol),
    ).toEqual(["Y", "X"]);
    expect(
      sortPositions(valued.positions, "pnlPct").map((p) => p.symbol),
    ).toEqual(["X", "Y"]);
    expect(sortPositions(valued.positions, "pnl").map((p) => p.symbol)).toEqual(
      ["X", "Y"],
    );
    expect(
      sortPositions(valued.positions, "value").map((p) => p.symbol),
    ).toEqual(["X", "Y"]);
  });

  it("no muta la entrada y es estable entre corridas", () => {
    const before = open.map((p) => p.symbol);
    sortPositions(open, "pnl");
    expect(open.map((p) => p.symbol)).toEqual(before);
    expect(symbols("pnl")).toEqual(symbols("pnl"));
  });

  it("sin precio para ninguna: se ordena por costo base (mayor primero)", () => {
    const valued = valuePortfolio(
      computeEngine([buy(T, "SMALL", "1", "10"), buy(T, "BIG", "10", "100")]),
      new Map(),
    );
    expect(
      sortPositions(valued.positions, "value").map((p) => p.symbol),
    ).toEqual(["BIG", "SMALL"]);
  });
});

describe("splitPositions", () => {
  it("separa abiertas y cerradas; las cerradas por realizado", () => {
    const result = computeEngine([
      buy(T, "WIN", "1", "10"),
      sell("2026-02-01T00:00:00Z", "WIN", "1", "30"), // +20
      buy(T, "LOSS", "1", "10"),
      sell("2026-02-01T00:00:00Z", "LOSS", "1", "4"), // −6
      buy(T, "KEEP", "1", "10"),
    ]);
    const { open, closed } = splitPositions(
      valuePortfolio(result, new Map()).positions,
    );
    expect(open.map((p) => p.symbol)).toEqual(["KEEP"]);
    expect(closed.map((p) => p.symbol)).toEqual(["WIN", "LOSS"]);
  });
});

describe("buildDashboard", () => {
  const now = new Date("2026-09-24T18:00:00Z");

  describe("ganancia total (valor − aportado)", () => {
    const at = new Date("2026-09-24T18:00:00Z");
    const view = (
      txs: Parameters<typeof computeEngine>[0],
      prices: Map<string, PriceInfo>,
    ) => buildDashboard(valuePortfolio(computeEngine(txs), prices), txs, at);

    it("depósito, compra y suba de precio: 1100 − 1000 = 100 (10 % de lo aportado)", () => {
      const v = view(
        [deposit(T, "1000"), buy(T, "AAA", "10", "50")],
        new Map([["AAA", price("60", "60")]]),
      );
      expect(v.netContributed.toFixed()).toBe("1000");
      expect(v.totalGain!.toFixed()).toBe("100");
      expect(v.totalGainPct!.toFixed()).toBe("0.1");
    });

    it("un retiro baja lo aportado y no cuenta como pérdida: 900 − 800 = 100 (12,5 %)", () => {
      const v = view(
        [deposit(T, "1000"), buy(T, "AAA", "10", "50"), withdrawal(T, "200")],
        new Map([["AAA", price("60", "60")]]),
      );
      expect(v.netContributed.toFixed()).toBe("800");
      expect(v.totalGain!.toFixed()).toBe("100");
      expect(v.totalGainPct!.toFixed()).toBe("0.125");
    });

    it("con todos los tipos de movimiento coincide con realizado + no realizado + dividendos + intereses − comisiones − impuestos", () => {
      // Efectivo: 5000 − 1002 + 479 + 3 − 5 + 2 − 1 − 500 = 3976. Posición: 6 a costo 100,2 (601,2),
      // precio 110 → 660. Total 4636; aportado 4500 → ganancia 136.
      // Realizado: 479 − 4 × 100,2 = 78,2. No realizado: 660 − 601,2 = 58,8.
      // 58,8 + 78,2 + 3 (dividendo) + 2 (interés) − 5 (comisión) − 1 (impuesto) = 136.
      const txs = [
        deposit(T, "5000"),
        buy(T, "AAA", "10", "100", "2"),
        sell("2026-01-06T15:00:00Z", "AAA", "4", "120", "1"),
        dividend("2026-01-07T15:00:00Z", "AAA", "3"),
        cashTx("FEE", "2026-01-08T15:00:00Z", "5"),
        cashTx("INTEREST", "2026-01-09T15:00:00Z", "2"),
        cashTx("TAX", "2026-01-10T15:00:00Z", "1"),
        withdrawal("2026-01-11T15:00:00Z", "500"),
      ];
      const result = computeEngine(txs);
      const valued = valuePortfolio(
        result,
        new Map([["AAA", price("110", "110")]]),
      );
      const v = buildDashboard(valued, txs, at);
      expect(v.totalGain!.toFixed()).toBe("136");
      const t = result.totals;
      expect(
        valued.unrealizedPnl
          .plus(t.realizedPnl)
          .plus(t.dividends)
          .plus(t.interest)
          .minus(t.fees)
          .minus(t.taxes)
          .toFixed(),
      ).toBe("136");
    });

    it("una pérdida es negativa", () => {
      const v = view(
        [deposit(T, "1000"), buy(T, "AAA", "10", "50")],
        new Map([["AAA", price("40", "40")]]),
      );
      expect(v.totalGain!.toFixed()).toBe("-100");
      expect(v.totalGainPct!.toFixed()).toBe("-0.1");
    });

    it("sin el precio de alguna posición el total es parcial: no hay ganancia total", () => {
      const v = view(
        [
          deposit(T, "1000"),
          buy(T, "AAA", "10", "50"),
          buy(T, "BBB", "1", "5"),
        ],
        new Map([["AAA", price("60", "60")]]),
      );
      expect(v.missingPrices).toEqual(["BBB"]);
      expect(v.totalGain).toBeNull();
      expect(v.totalGainPct).toBeNull();
    });

    it("sin aportes positivos no hay contra qué comparar", () => {
      const noDeposits = view(
        [buy(T, "AAA", "1", "10")],
        new Map([["AAA", price("12", "12")]]),
      );
      expect(noDeposits.totalGain).toBeNull();
      // Se retiró más de lo que se puso: lo aportado neto es negativo.
      const overdrawn = view(
        [deposit(T, "100"), withdrawal(T, "300")],
        new Map(),
      );
      expect(overdrawn.netContributed.toFixed()).toBe("-200");
      expect(overdrawn.totalGain).toBeNull();
    });
  });

  it("dividendos del año calendario, en hora de Montevideo", () => {
    const txs = [
      dividend("2026-03-27T13:30:00Z", "VOO", "1.872"),
      dividend("2026-06-26T13:30:00Z", "VOO", "1.962"),
      dividend("2025-12-26T13:30:00Z", "VOO", "9"), // año anterior
      dividend("2026-01-01T02:59:59Z", "VOO", "7"), // todavía 31/12/2025 en Montevideo
      dividend("2026-01-01T03:00:00Z", "VOO", "0.5"), // 1/1/2026 00:00 en Montevideo
    ];
    const view = buildDashboard(
      valuePortfolio(computeEngine(txs), new Map()),
      txs,
      now,
    );
    expect(view.dividendsThisYear.toFixed()).toBe("4.334"); // 1.872 + 1.962 + 0.5
  });

  it("el año lo decide 'ahora' en Montevideo, no en UTC", () => {
    const txs = [dividend("2026-06-01T12:00:00Z", "VOO", "2")];
    const valued = valuePortfolio(computeEngine(txs), new Map());
    // 01:59 UTC del 1/1/2027 todavía es 31/12/2026 en Montevideo: cuenta como 2026.
    expect(
      buildDashboard(
        valued,
        txs,
        new Date("2027-01-01T01:59:00Z"),
      ).dividendsThisYear.toFixed(),
    ).toBe("2");
    expect(
      buildDashboard(
        valued,
        txs,
        new Date("2027-01-01T03:00:00Z"),
      ).dividendsThisYear.toFixed(),
    ).toBe("0");
  });

  it("estado vacío, valor parcial, efectivo negativo y fecha de los precios", () => {
    const empty = buildDashboard(
      valuePortfolio(computeEngine([]), new Map()),
      [],
      now,
    );
    expect(empty.hasTransactions).toBe(false);
    expect(empty.oldestPriceAt).toBeNull();

    const view = buildDashboard(sample(), [deposit(T, "1")], now);
    expect(view.hasTransactions).toBe(true);
    expect(view.missingPrices).toEqual(["NOPRICE"]);
    expect(view.negativeCash).toBe(false);

    const negative = buildDashboard(
      valuePortfolio(computeEngine([buy(T, "AAA", "1", "10")]), new Map()),
      [],
      now,
    );
    expect(negative.negativeCash).toBe(true);
  });

  it("muestra la fecha del precio MÁS antiguo (la más conservadora)", () => {
    const result = computeEngine([
      buy(T, "AAA", "1", "10"),
      buy(T, "BBB", "1", "10"),
    ]);
    const view = buildDashboard(
      valuePortfolio(
        result,
        new Map([
          ["AAA", price("11", "10", "2026-09-23T20:00:00Z")],
          ["BBB", price("11", "10", "2026-09-19T21:00:00Z")],
        ]),
      ),
      [],
      now,
    );
    expect(view.oldestPriceAt).toEqual(new Date("2026-09-19T21:00:00Z"));
  });
});

describe("parseActivityFilters", () => {
  it("sin parámetros: todo vacío, página 0", () => {
    expect(parseActivityFilters({})).toEqual({
      type: null,
      symbol: null,
      from: null,
      to: null,
      page: 0,
    });
  });

  it("filtros válidos, con el símbolo normalizado", () => {
    expect(
      parseActivityFilters({
        tipo: "BUY",
        simbolo: "brk.b",
        desde: "2026-03-01",
        hasta: "2026-03-31",
        pagina: "2",
      }),
    ).toEqual({
      type: "BUY",
      symbol: "BRK-B",
      from: "2026-03-01",
      to: "2026-03-31",
      page: 2,
    });
  });

  it("lo inválido se ignora en vez de romper (la URL la pudo escribir cualquiera)", () => {
    expect(
      parseActivityFilters({
        tipo: "__proto__",
        simbolo: "'; drop table",
        desde: "ayer",
        hasta: "2026-02-31",
        pagina: "-1",
      }),
    ).toEqual({ type: null, symbol: null, from: null, to: null, page: 0 });
    expect(parseActivityFilters({ tipo: "buy" }).type).toBeNull(); // distingue mayúsculas
    expect(parseActivityFilters({ pagina: "1.5" }).page).toBe(0);
    expect(parseActivityFilters({ pagina: "abc" }).page).toBe(0);
    expect(parseActivityFilters({ pagina: "99999999" }).page).toBe(0);
    expect(parseActivityFilters({ simbolo: "A".repeat(40) }).symbol).toBeNull();
  });

  it("toma el primer valor si el parámetro viene repetido", () => {
    expect(parseActivityFilters({ tipo: ["SELL", "BUY"] }).type).toBe("SELL");
  });

  it("si desde es posterior a hasta, los intercambia", () => {
    expect(
      parseActivityFilters({ desde: "2026-05-01", hasta: "2026-03-01" }),
    ).toMatchObject({ from: "2026-03-01", to: "2026-05-01" });
  });

  it("todos los tipos de transacción son filtrables", () => {
    for (const type of [
      "BUY",
      "SELL",
      "DIVIDEND",
      "DEPOSIT",
      "WITHDRAWAL",
      "FEE",
      "INTEREST",
      "SPLIT",
      "TAX",
    ]) {
      expect(parseActivityFilters({ tipo: type }).type).toBe(type);
    }
  });
});

describe("localRangeToUtc", () => {
  it("un día local completo en UTC: desde las 03:00Z hasta las 03:00Z del día siguiente", () => {
    expect(localRangeToUtc("2026-03-09", "2026-03-09")).toEqual({
      gte: "2026-03-09T03:00:00.000Z",
      lt: "2026-03-10T03:00:00.000Z",
    });
  });

  it("el `hasta` incluye todo su día, también en el borde de mes y de año", () => {
    expect(localRangeToUtc(null, "2026-12-31").lt).toBe(
      "2027-01-01T03:00:00.000Z",
    );
    expect(localRangeToUtc(null, "2026-02-28").lt).toBe(
      "2026-03-01T03:00:00.000Z",
    );
    expect(localRangeToUtc(null, "2028-02-28").lt).toBe(
      "2028-02-29T03:00:00.000Z",
    ); // bisiesto
  });

  it("sin extremos no acota", () => {
    expect(localRangeToUtc(null, null)).toEqual({ gte: null, lt: null });
    expect(localRangeToUtc("2026-01-01", null)).toEqual({
      gte: "2026-01-01T03:00:00.000Z",
      lt: null,
    });
  });
});

describe("activityQuery", () => {
  it("arma el query string solo con lo que tiene valor", () => {
    expect(activityQuery({})).toBe("");
    expect(activityQuery({ type: "BUY", symbol: "VOO", page: 2 })).toBe(
      "?tipo=BUY&simbolo=VOO&pagina=2",
    );
    expect(
      activityQuery({ from: "2026-03-01", to: "2026-03-31", page: 0 }),
    ).toBe("?desde=2026-03-01&hasta=2026-03-31");
  });

  it("es el inverso de parseActivityFilters", () => {
    const filters = {
      type: "SELL",
      symbol: "BRK-B",
      from: "2026-03-01",
      to: "2026-03-31",
      page: 3,
    } as const;
    const params = Object.fromEntries(
      new URLSearchParams(activityQuery(filters).slice(1)),
    );
    expect(parseActivityFilters(params)).toEqual(filters);
  });
});

describe("groupByDay", () => {
  it("agrupa por día local conservando el orden, y parte el día a las 00:00 de Montevideo", () => {
    const rows = [
      { executed_at: "2026-03-10T02:59:00+00:00", n: 1 }, // 9/3 23:59 en Montevideo
      { executed_at: "2026-03-09T22:34:00+00:00", n: 2 },
      { executed_at: "2026-03-09T03:00:00+00:00", n: 3 }, // 9/3 00:00
      { executed_at: "2026-03-09T02:59:00+00:00", n: 4 }, // 8/3 23:59
    ];
    expect(
      groupByDay(rows).map((g) => [g.dayKey, g.rows.map((r) => r.n)]),
    ).toEqual([
      ["2026-03-09", [1, 2, 3]],
      ["2026-03-08", [4]],
    ]);
  });

  it("vacío y tamaño de página", () => {
    expect(groupByDay([])).toEqual([]);
    expect(ACTIVITY_PAGE_SIZE).toBe(50);
  });
});
