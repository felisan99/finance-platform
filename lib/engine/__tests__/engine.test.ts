import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  computeEngine,
  createLedger,
  d,
  finalizeLedger,
  type Transaction,
} from "../index";
import {
  buy,
  cashTx,
  deepFreeze,
  deposit,
  dividend,
  expectDec,
  positionOf,
  sell,
  snapshot,
  split,
  withdrawal,
} from "./helpers";

const T1 = "2026-01-01T00:00:00Z";
const T2 = "2026-01-02T00:00:00Z";
const T3 = "2026-01-03T00:00:00Z";
const T4 = "2026-01-04T00:00:00Z";

describe("computeEngine", () => {
  it("un historial vacío no tiene posiciones, efectivo ni issues", () => {
    const r = computeEngine([]);
    expect(r.positions).toEqual([]);
    expect(r.issues).toEqual([]);
    expectDec(r.cash, "0");
    for (const value of Object.values(r.totals)) expectDec(value, "0");
  });

  it("una compra descuenta efectivo y abre la posición", () => {
    const r = computeEngine([
      deposit(T1, "1000"),
      buy(T2, "VOO", "3", "100", "1"),
    ]);
    expectDec(r.cash, "699");
    const p = positionOf(r, "VOO");
    expectDec(p.quantity, "3");
    expectDec(p.costBasis, "301");
    expect(p.isOpen).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("compra, venta parcial y venta total: realizado y efectivo", () => {
    const r = computeEngine([
      deposit(T1, "1000"),
      buy(T2, "X", "10", "10", "1"), // efectivo 899
      sell(T3, "X", "4", "12", "1"), // +47 -> 946, realizado 6.6
      sell(T4, "X", "6", "11", "1"), // +65 -> 1011, realizado 4.4
    ]);
    const p = positionOf(r, "X");
    expect(p.isOpen).toBe(false);
    expectDec(p.realizedPnl, "11");
    expectDec(r.cash, "1011");
    expectDec(r.totals.realizedPnl, "11");
    expectDec(r.totals.openCostBasis, "0");
  });

  it("devuelve abiertas y cerradas, ordenadas por símbolo", () => {
    const r = computeEngine([
      deposit(T1, "1000"),
      buy(T2, "VOO", "1", "100"),
      buy(T2, "KOS", "2", "10"),
      buy(T2, "AAPL", "1", "50"),
      sell(T3, "KOS", "2", "12"),
    ]);
    expect(r.positions.map((p) => [p.symbol, p.isOpen])).toEqual([
      ["AAPL", true],
      ["KOS", false],
      ["VOO", true],
    ]);
  });

  it("recomprar tras cerrar reabre la posición conservando el realizado", () => {
    const r = computeEngine([
      buy(T1, "X", "5", "10"),
      sell(T2, "X", "5", "12"), // realizado 10
      buy(T3, "X", "5", "20"),
    ]);
    const p = positionOf(r, "X");
    expect(p.isOpen).toBe(true);
    expectDec(p.costBasis, "100");
    expectDec(p.realizedPnl, "10");
  });
});

describe("issues de validación (no lanza, descarta la transacción)", () => {
  it("SELL_EXCEEDS_HOLDINGS: la venta se descarta y queda reportada", () => {
    const bad = sell(T3, "VOO", "3", "100");
    const r = computeEngine([
      deposit(T1, "1000"),
      buy(T2, "VOO", "2", "100"),
      bad,
    ]);
    const [issue] = r.issues;
    expect(r.issues).toHaveLength(1);
    expect(issue).toMatchObject({
      severity: "error",
      code: "SELL_EXCEEDS_HOLDINGS",
      txId: bad.id,
      symbol: "VOO",
    });
    // Es como si la venta inválida no existiera.
    expectDec(r.cash, "800");
    expectDec(positionOf(r, "VOO").quantity, "2");
  });

  it("vender un símbolo sin posición no crea la posición", () => {
    const r = computeEngine([deposit(T1, "100"), sell(T2, "GHOST", "1", "10")]);
    expect(r.issues.map((i) => i.code)).toEqual(["SELL_EXCEEDS_HOLDINGS"]);
    expect(r.positions).toEqual([]);
    expectDec(r.cash, "100");
  });

  it("UNSUPPORTED_CURRENCY: otra moneda se descarta", () => {
    const eur: Transaction = { ...deposit(T1, "100"), currency: "EUR" };
    const r = computeEngine([eur]);
    expect(r.issues).toMatchObject([
      { severity: "error", code: "UNSUPPORTED_CURRENCY" },
    ]);
    expectDec(r.cash, "0");
  });

  it("la opción `currency` cambia la moneda soportada", () => {
    const eur: Transaction = { ...deposit(T1, "100"), currency: "EUR" };
    const r = computeEngine([eur], { currency: "EUR" });
    expect(r.issues).toEqual([]);
    expectDec(r.cash, "100");
    // `currency: undefined` no pisa el valor por defecto (USD)
    expect(
      computeEngine([deposit(T1, "5")], { currency: undefined }).issues,
    ).toEqual([]);
  });

  const invalidCases: [string, Transaction][] = [
    ["cantidad 0", buy(T1, "X", "0", "10")],
    ["cantidad negativa", buy(T1, "X", "-1", "10")],
    ["precio negativo", buy(T1, "X", "1", "-1")],
    ["comisión negativa", buy(T1, "X", "1", "10", "-1")],
    ["símbolo vacío", buy(T1, "", "1", "10")],
    ["cantidad NaN", { ...buy(T1, "X", "1", "10"), quantity: d("NaN") }],
    ["depósito de 0", deposit(T1, "0")],
    ["retiro negativo", withdrawal(T1, "-5")],
    ["dividendo de 0", dividend(T1, "X", "0")],
    ["split con razón 0", split(T1, "X", "0")],
    [
      "fecha inválida",
      { ...buy(T1, "X", "1", "10"), executedAt: new Date("no es una fecha") },
    ],
    ["interés infinito", cashTx("INTEREST", T1, "Infinity")],
  ];

  it.each(invalidCases)("INVALID_TRANSACTION: %s", (_name, tx) => {
    const r = computeEngine([tx]);
    expect(r.issues).toMatchObject([
      { severity: "error", code: "INVALID_TRANSACTION" },
    ]);
    expect(r.positions).toEqual([]);
    expectDec(r.cash, "0");
  });

  it("un INTEREST negativo (interés de margen) es válido", () => {
    const r = computeEngine([
      deposit(T1, "100"),
      cashTx("INTEREST", T2, "-2.5"),
    ]);
    expect(r.issues).toEqual([]);
    expectDec(r.cash, "97.5");
    expectDec(r.totals.interest, "-2.5");
  });
});

describe("dividendos y splits", () => {
  it("un dividendo suma al efectivo y a la posición", () => {
    const r = computeEngine([
      deposit(T1, "1000"),
      buy(T2, "VOO", "2", "100"),
      dividend(T3, "VOO", "1.75"),
    ]);
    expectDec(r.cash, "801.75");
    expectDec(positionOf(r, "VOO").dividends, "1.75");
    expectDec(r.totals.dividends, "1.75");
  });

  it("un dividendo de un símbolo sin compras crea una posición cerrada con sus dividendos", () => {
    const r = computeEngine([dividend(T1, "OLD", "3")]);
    const p = positionOf(r, "OLD");
    expect(p.isOpen).toBe(false);
    expectDec(p.dividends, "3");
    expectDec(r.cash, "3");
  });

  it("un split cambia la cantidad, no el costo, y las ventas siguientes usan el nuevo promedio", () => {
    const r = computeEngine([
      deposit(T1, "2000"),
      buy(T2, "NVDA", "10", "100"), // costo 1000
      split(T3, "NVDA", "10"), // 100 acciones, promedio 10
      sell(T4, "NVDA", "50", "12"), // proceeds 600, costo 500 -> realizado 100
    ]);
    const p = positionOf(r, "NVDA");
    expectDec(p.quantity, "50");
    expectDec(p.costBasis, "500");
    expectDec(p.realizedPnl, "100");
    expect(r.issues).toEqual([]);
  });

  it("un split sin posición abierta es una advertencia y no crea nada", () => {
    const orphan = split(T1, "NVDA", "10");
    const r = computeEngine([orphan]);
    expect(r.issues).toMatchObject([
      { severity: "warning", code: "SPLIT_WITHOUT_POSITION", txId: orphan.id },
    ]);
    expect(r.positions).toEqual([]);

    // También si la posición ya estaba cerrada.
    const closed = computeEngine([
      buy(T1, "X", "1", "10"),
      sell(T2, "X", "1", "12"),
      split(T3, "X", "2"),
    ]);
    expect(closed.issues.map((i) => i.code)).toEqual([
      "SPLIT_WITHOUT_POSITION",
    ]);
  });
});

describe("efectivo negativo (spec §6.2: advertir, no bloquear)", () => {
  it("un saldo final negativo advierte", () => {
    const r = computeEngine([deposit(T1, "100"), buy(T2, "X", "2", "100")]);
    expectDec(r.cash, "-100");
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({
      severity: "warning",
      code: "NEGATIVE_CASH",
    });
    expectDec(positionOf(r, "X").quantity, "2"); // la compra no se bloquea
  });

  it("un negativo transitorio no advierte (la compra se registró antes del depósito)", () => {
    // Igual que MELI en el fixture de Delta: compra a las 17:27:49, depósito a las 17:28:41.
    const r = computeEngine([
      buy("2026-06-11T17:27:49Z", "MELI", "1", "1612.45", "1"),
      deposit("2026-06-11T17:28:41Z", "3600"),
    ]);
    expectDec(r.cash, "1986.55");
    expect(r.issues).toEqual([]);
  });
});

describe("totales", () => {
  it("suma cada concepto y cumple la conservación del capital", () => {
    const r = computeEngine([
      deposit(T1, "1000"),
      withdrawal(T2, "100"),
      buy("2026-01-03T00:00:00Z", "VOO", "2", "50", "1"), // costo 101
      sell("2026-01-04T00:00:00Z", "VOO", "1", "60", "1"), // proceeds 59, costo 50.5 -> +8.5
      dividend("2026-01-05T00:00:00Z", "VOO", "5"),
      cashTx("INTEREST", "2026-01-06T00:00:00Z", "2"),
      cashTx("FEE", "2026-01-07T00:00:00Z", "3"),
      cashTx("TAX", "2026-01-08T00:00:00Z", "1", "VOO"),
    ]);
    const t = r.totals;
    expectDec(t.deposits, "1000");
    expectDec(t.withdrawals, "100");
    expectDec(t.interest, "2");
    expectDec(t.fees, "3");
    expectDec(t.taxes, "1");
    expectDec(t.dividends, "5");
    expectDec(t.realizedPnl, "8.5");
    expectDec(t.openCostBasis, "50.5");
    expectDec(r.cash, "861");
    // depósitos − retiros + realizado + dividendos + intereses − fees − impuestos = efectivo + costo abierto
    const lhs = t.deposits
      .minus(t.withdrawals)
      .plus(t.realizedPnl)
      .plus(t.dividends)
      .plus(t.interest)
      .minus(t.fees)
      .minus(t.taxes);
    expectDec(lhs, r.cash.plus(t.openCostBasis).toFixed());
  });
});

describe("orden y pureza", () => {
  const history = [
    deposit("2026-01-01T10:00:00Z", "5000"),
    buy("2026-01-02T10:00:00Z", "VOO", "3", "400", "1"),
    buy("2026-01-03T10:00:00Z", "KOS", "37", "2.81", "1"),
    dividend("2026-01-04T10:00:00Z", "VOO", "2.1"),
    sell("2026-01-05T10:00:00Z", "KOS", "37", "3.165", "1"),
    split("2026-01-06T10:00:00Z", "VOO", "2"),
    sell("2026-01-07T10:00:00Z", "VOO", "2", "210", "1"),
    withdrawal("2026-01-08T10:00:00Z", "300"),
  ];

  it("el resultado no depende del orden de entrada", () => {
    const expected = snapshot(computeEngine(history));
    expect(snapshot(computeEngine([...history].reverse()))).toEqual(expected);
    expect(
      snapshot(
        computeEngine([
          history[3]!,
          history[6]!,
          ...history.slice(0, 3),
          ...history.slice(4, 6),
          history[7]!,
        ]),
      ),
    ).toEqual(expected);
  });

  it("desempata por createdAt cuando executedAt coincide", () => {
    const first = {
      ...buy(T1, "X", "1", "10"),
      createdAt: new Date("2026-01-01T00:00:02Z"),
    };
    const second = {
      ...sell(T1, "X", "1", "12"),
      createdAt: new Date("2026-01-01T00:00:03Z"),
    };
    const r = computeEngine([second, first]); // llegan al revés
    expect(r.issues).toEqual([]);
    expect(positionOf(r, "X").isOpen).toBe(false);
  });

  it("los empates completos respetan el orden de entrada", () => {
    const funds = deposit("2025-12-31T00:00:00Z", "100");
    const b = buy(T1, "X", "1", "10");
    const s = sell(T1, "X", "1", "12");
    expect(computeEngine([funds, b, s]).issues).toEqual([]);
    expect(computeEngine([funds, s, b]).issues.map((i) => i.code)).toEqual([
      "SELL_EXCEEDS_HOLDINGS",
    ]);
  });

  it("no muta la entrada (ni el arreglo ni las transacciones)", () => {
    const frozen = deepFreeze([...history]);
    expect(() => computeEngine(frozen)).not.toThrow();
    expect(frozen.map((tx) => tx.id)).toEqual(history.map((tx) => tx.id));
  });

  it("es determinista: dos corridas dan el mismo resultado", () => {
    expect(snapshot(computeEngine(history))).toEqual(
      snapshot(computeEngine(history)),
    );
  });

  it("rechaza transacciones de varias cuentas (mal uso, no datos malos)", () => {
    const other: Transaction = {
      ...deposit(T1, "10"),
      accountId: "otra-cuenta",
    };
    expect(() => computeEngine([deposit(T1, "10"), other])).toThrow(
      /una sola cuenta/,
    );
  });
});

describe("reducer applyTransaction", () => {
  const txs = [
    deposit(T1, "1000"),
    buy(T2, "VOO", "2", "100", "1"),
    sell(T3, "VOO", "1", "120", "1"),
  ];

  it("plegar las transacciones en orden equivale a computeEngine", () => {
    let state = createLedger();
    for (const tx of txs) state = applyTransaction(state, tx);
    expect(snapshot(finalizeLedger(state))).toEqual(
      snapshot(computeEngine(txs)),
    );
  });

  it("los estados anteriores no cambian (sirve para snapshots diarios)", () => {
    const afterDeposit = applyTransaction(createLedger(), txs[0]!);
    const afterBuy = applyTransaction(afterDeposit, txs[1]!);
    applyTransaction(afterBuy, txs[2]!);

    expectDec(finalizeLedger(afterDeposit).cash, "1000");
    expect(finalizeLedger(afterDeposit).positions).toEqual([]);
    expectDec(finalizeLedger(afterBuy).cash, "799");
    expectDec(positionOf(finalizeLedger(afterBuy), "VOO").quantity, "2");
  });
});
