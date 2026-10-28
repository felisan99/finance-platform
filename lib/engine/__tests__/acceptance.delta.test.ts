import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeCash, computeEngine, d, type Transaction } from "@/lib/engine";
import { parseDeltaCsv, toEngineTransactions } from "@/lib/importers";
import { ACCOUNT, expectDec, positionOf } from "./helpers";

// Test de aceptación de la Fase 1 (spec §8.3): el export de Delta del fixture, importado
// con parseDeltaCsv y calculado con computeEngine, debe dar exactamente estos números.

const csv = readFileSync(
  new URL("../__fixtures__/delta_export.csv", import.meta.url),
  "utf8",
);
const IMPORTED_AT = new Date("2026-09-23T12:00:00Z");

const parsed = parseDeltaCsv(csv);
const txs = toEngineTransactions(parsed.transactions, {
  accountId: ACCOUNT,
  importedAt: IMPORTED_AT,
});
const result = computeEngine(txs);

describe("importador: CSV de Delta", () => {
  it("lee las 53 filas: 28 transacciones, 25 ignoradas y ningún error", () => {
    expect(parsed.fatal).toBeNull();
    expect(parsed.errors).toEqual([]);
    expect(parsed.stats).toEqual({
      rowsTotal: 53,
      imported: 28,
      skipped: 25,
      errors: 0,
    });
  });

  it("las 25 filas ignoradas son las patas de efectivo SYNC-BASE-HOLDINGS", () => {
    expect(parsed.skipped).toHaveLength(25);
    expect(new Set(parsed.skipped.map((s) => s.reason))).toEqual(
      new Set(["SYNC_BASE_HOLDINGS_LEG"]),
    );
  });

  it("mapea 20 BUY, 5 SELL y 3 DEPOSIT (9300 en total)", () => {
    const count = (type: string) =>
      parsed.transactions.filter((t) => t.type === type).length;
    expect([
      count("BUY"),
      count("SELL"),
      count("DEPOSIT"),
      count("WITHDRAWAL"),
    ]).toEqual([20, 5, 3, 0]);

    const deposits = parsed.transactions.filter((t) => t.type === "DEPOSIT");
    const total = deposits.reduce(
      (sum, t) => sum.plus("amount" in t ? t.amount : 0),
      d("0"),
    );
    expectDec(total, "9300");
    // La nota "Comision 30USD" se conserva; el depósito es el monto neto de Delta (4200).
    expect(deposits[0]).toMatchObject({ notes: "Comision 30USD" });
  });

  it("detecta los 10 instrumentos con su tipo y nombre", () => {
    const bySymbol = Object.fromEntries(
      parsed.instruments.map((i) => [i.symbol, i]),
    );
    expect(Object.keys(bySymbol).sort()).toEqual([
      "FSLY",
      "ILF",
      "KOS",
      "MELI",
      "NFLX",
      "QCOM",
      "SOXX",
      "TTWO",
      "URTH",
      "VOO",
    ]);
    for (const etf of ["VOO", "ILF", "URTH", "SOXX"])
      expect(bySymbol[etf]?.type).toBe("ETF");
    for (const stock of ["KOS", "QCOM", "TTWO", "NFLX", "MELI", "FSLY"]) {
      expect(bySymbol[stock]?.type).toBe("STOCK");
    }
    expect(bySymbol.VOO?.name).toBe("Vanguard S&P 500 ETF");
    expect(bySymbol.TTWO?.name).toBe("Take-Two Interactive Software Inc");
  });

  it("el precio es Quote ÷ Base (el total no es el unitario) y las 5 compras sin comisión valen 0", () => {
    const firstVoo = parsed.transactions.find(
      (t) => t.type === "BUY" && t.symbol === "VOO",
    );
    expect(firstVoo).toBeDefined();
    if (firstVoo?.type === "BUY") {
      expectDec(firstVoo.quantity, "3");
      expectDec(firstVoo.price, "575.24"); // 1725.72 / 3
      expectDec(firstVoo.fee, "1");
    }
    const kosSell = parsed.transactions.find(
      (t) => t.type === "SELL" && t.symbol === "KOS",
    );
    expect(kosSell).toBeDefined();
    if (kosSell?.type === "SELL") expectDec(kosSell.price, "3.165"); // 117.105 / 37

    const feeless = parsed.transactions.filter(
      (t) => t.type === "BUY" && t.fee.isZero(),
    );
    expect(feeless).toHaveLength(5);
  });

  it("los externalId son únicos y estables entre corridas", () => {
    const ids = parsed.transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(28);
    expect(parseDeltaCsv(csv).transactions.map((t) => t.externalId)).toEqual(
      ids,
    );
    expect(ids.every((id) => !id.includes("#"))).toBe(true); // ninguna fila idéntica en el archivo
  });

  it("las transacciones quedan en orden cronológico", () => {
    const times = parsed.transactions.map((t) => t.executedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("Aceptación §8.3: motor sobre el CSV de Delta (costo promedio, comisiones en el costo)", () => {
  it("posiciones abiertas: cantidad y costo base", () => {
    const expected: [symbol: string, quantity: string, costBasis: string][] = [
      ["VOO", "8.95", "5724.77"],
      ["SOXX", "4", "2069.5"],
      ["FSLY", "30", "346.80"],
      ["ILF", "12", "331.60"],
      ["NFLX", "2", "191.60"],
    ];
    const open = result.positions.filter((p) => p.isOpen);
    expect(open.map((p) => p.symbol).sort()).toEqual(
      expected.map(([s]) => s).sort(),
    );
    for (const [symbol, quantity, costBasis] of expected) {
      const p = positionOf(result, symbol);
      expectDec(p.quantity, quantity);
      expectDec(p.costBasis, costBasis);
    }
    expectDec(result.totals.openCostBasis, "8664.27");
  });

  it("posiciones cerradas: ganancia realizada", () => {
    const expected: [symbol: string, realized: string][] = [
      ["MELI", "180.55"],
      ["URTH", "42.7"],
      ["KOS", "11.135"],
      ["QCOM", "7.52"],
      ["TTWO", "5.11"],
    ];
    const closed = result.positions.filter((p) => !p.isOpen);
    expect(closed.map((p) => p.symbol).sort()).toEqual(
      expected.map(([s]) => s).sort(),
    );
    for (const [symbol, realized] of expected) {
      const p = positionOf(result, symbol);
      expectDec(p.realizedPnl, realized);
      expectDec(p.quantity, "0");
      expectDec(p.costBasis, "0");
    }
    expectDec(result.totals.realizedPnl, "247.015");
  });

  it("efectivo: 9300 − 11696.66 + 3279.405 = 882.745", () => {
    expectDec(result.totals.deposits, "9300");
    expectDec(result.cash, "882.745");
    expectDec(computeCash(txs), "882.745"); // la fórmula suelta coincide con el motor
  });

  it("no hay issues: el efectivo negativo transitorio de MELI (17:27:49Z, antes del depósito de 17:28:41Z) no cuenta", () => {
    expect(result.issues).toEqual([]);
  });

  it("conserva el capital: depósitos + realizado = efectivo + costo abierto", () => {
    const lhs = result.totals.deposits.plus(result.totals.realizedPnl);
    const rhs = result.cash.plus(result.totals.openCostBasis);
    expectDec(lhs, "9547.015");
    expectDec(rhs, "9547.015");
  });

  it("compra manual BUY DDOG 2 @ 251.41 fee 1.00 (2026-09-23): costo 503.82 y efectivo 378.925", () => {
    const ddog: Transaction = {
      id: "manual-ddog",
      accountId: ACCOUNT,
      type: "BUY",
      symbol: "DDOG",
      executedAt: new Date("2026-09-23T14:30:00Z"),
      createdAt: new Date("2026-09-23T14:30:00Z"),
      currency: "USD",
      quantity: d("2"),
      price: d("251.41"),
      fee: d("1.00"),
    };
    const after = computeEngine([...txs, ddog]);

    const p = positionOf(after, "DDOG");
    expectDec(p.quantity, "2");
    expectDec(p.costBasis, "503.82");
    expectDec(after.cash, "378.925");
    expectDec(after.totals.openCostBasis, "9168.09"); // 8664.27 + 503.82
    expect(after.issues).toEqual([]);
    // Lo demás no cambia.
    expectDec(positionOf(after, "VOO").costBasis, "5724.77");
    expectDec(after.totals.realizedPnl, "247.015");
  });
});
