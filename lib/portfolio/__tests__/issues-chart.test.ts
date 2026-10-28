import { describe, expect, it } from "vitest";
import { computeEngine, d, type EngineIssue } from "@/lib/engine";
import { buy, deposit, sell } from "@/lib/engine/__tests__/helpers";
import { buildPositionChart, tradeDay } from "../chart-data";
import { describeIssue, describeRejectedChange } from "../issues";

describe("describeIssue", () => {
  const oversell: EngineIssue = {
    severity: "error",
    code: "SELL_EXCEEDS_HOLDINGS",
    txId: "t1",
    symbol: "AAA",
    requested: d("11"),
    available: d("10"),
  };

  it("cada código tiene su mensaje en español", () => {
    expect(describeIssue(oversell)).toBe(
      "Vende 11 AAA pero solo hay 10 disponibles",
    );
    expect(
      describeIssue({
        severity: "error",
        code: "INVALID_TRANSACTION",
        txId: "t",
        message: "Fecha inválida",
      }),
    ).toBe("Fecha inválida");
    expect(
      describeIssue({
        severity: "error",
        code: "UNSUPPORTED_CURRENCY",
        txId: "t",
        message: "Moneda EUR no soportada (solo USD)",
      }),
    ).toMatch(/EUR/);
    expect(
      describeIssue({
        severity: "warning",
        code: "SPLIT_WITHOUT_POSITION",
        txId: "t",
        symbol: "X",
      }),
    ).toBe("Split de X sin tener la posición");
    expect(
      describeIssue({
        severity: "warning",
        code: "NEGATIVE_CASH",
        cash: d("-50"),
      }),
    ).toMatch(/efectivo queda negativo \(-50 USD\)/);
  });

  it("con `rowOf` indica la fila del archivo", () => {
    expect(describeIssue(oversell, new Map([["t1", 14]]))).toMatch(
      /\(fila 14 del archivo\)$/,
    );
    expect(describeIssue(oversell, new Map())).not.toMatch(/fila/);
  });

  it("los errores reales del motor se describen sin lanzar", () => {
    const result = computeEngine([
      deposit("2026-01-01T00:00:00Z", "10"),
      sell("2026-01-02T00:00:00Z", "AAA", "1", "5"),
    ]);
    for (const issue of result.issues)
      expect(describeIssue(issue).length).toBeGreaterThan(5);
  });
});

describe("describeRejectedChange", () => {
  const issue = (n: number): EngineIssue => ({
    severity: "error",
    code: "SELL_EXCEEDS_HOLDINGS",
    txId: `t${n}`,
    symbol: "AAA",
    requested: d("2"),
    available: d("1"),
  });

  it("nombra el primer problema y cuenta los demás", () => {
    expect(describeRejectedChange([issue(1)])).toBe(
      "Ese cambio deja el registro inconsistente: Vende 2 AAA pero solo hay 1 disponibles.",
    );
    expect(describeRejectedChange([issue(1), issue(2)])).toMatch(
      /\(y 1 problema más\)\.$/,
    );
    expect(describeRejectedChange([issue(1), issue(2), issue(3)])).toMatch(
      /\(y 2 problemas más\)\.$/,
    );
  });

  it("sin detalle, un mensaje genérico", () => {
    expect(describeRejectedChange([])).toBe(
      "El cambio deja el registro inconsistente",
    );
  });
});

describe("tradeDay", () => {
  it("fecha de la rueda en hora de Nueva York", () => {
    expect(tradeDay(new Date("2026-03-09T22:34:00Z"))).toBe("2026-03-09"); // 18:34 EDT
    expect(tradeDay(new Date("2026-03-10T01:30:00Z"))).toBe("2026-03-09"); // 21:30 EDT del 9
    expect(tradeDay(new Date("2026-01-15T03:00:00Z"))).toBe("2026-01-14"); // 22:00 EST del 14
  });
});

describe("buildPositionChart", () => {
  const series = [
    { date: "2026-03-06", close: "600.5" },
    { date: "2026-03-09", close: "610" },
    { date: "2026-03-10", close: "615.25" },
    { date: "2026-03-13", close: "620" }, // el 11 y el 12 faltan (dato faltante)
  ];

  it("convierte la serie a números y pone los marcadores sobre el cierre de su día", () => {
    const txs = [
      buy("2026-03-09T22:34:00Z", "VOO", "3", "575.24", "1"),
      sell("2026-03-10T15:00:00Z", "VOO", "1", "616"),
    ];
    const chart = buildPositionChart(series, txs, "VOO", "575.24");
    expect(chart.points).toEqual([
      { date: "2026-03-06", close: 600.5 },
      { date: "2026-03-09", close: 610 },
      { date: "2026-03-10", close: 615.25 },
      { date: "2026-03-13", close: 620 },
    ]);
    expect(chart.markers).toEqual([
      {
        date: "2026-03-09",
        close: 610,
        type: "BUY",
        quantity: "3",
        price: "575.24",
      },
      {
        date: "2026-03-10",
        close: 615.25,
        type: "SELL",
        quantity: "1",
        price: "616",
      },
    ]);
    expect(chart.avgCost).toBe(575.24);
  });

  it("una operación en un día sin barra va sobre la barra anterior más cercana", () => {
    const chart = buildPositionChart(
      series,
      [buy("2026-03-12T15:00:00Z", "VOO", "1", "618")],
      "VOO",
      null,
    );
    expect(chart.markers[0]).toMatchObject({
      date: "2026-03-10",
      close: 615.25,
    });
  });

  it("una operación anterior al inicio de la serie no tiene marcador", () => {
    const chart = buildPositionChart(
      series,
      [buy("2026-03-01T15:00:00Z", "VOO", "1", "590")],
      "VOO",
      null,
    );
    expect(chart.markers).toEqual([]);
  });

  it("solo compras y ventas del símbolo pedido", () => {
    const txs = [
      buy("2026-03-09T22:34:00Z", "OTRO", "1", "10"),
      deposit("2026-03-09T22:00:00Z", "1000"),
      buy("2026-03-09T22:34:00Z", "VOO", "1", "610"),
    ];
    expect(buildPositionChart(series, txs, "VOO", null).markers).toHaveLength(
      1,
    );
  });

  it("posición cerrada: sin línea de costo promedio; serie vacía sin romper", () => {
    expect(buildPositionChart(series, [], "VOO", null).avgCost).toBeNull();
    expect(
      buildPositionChart(
        [],
        [buy("2026-03-09T22:34:00Z", "VOO", "1", "610")],
        "VOO",
        "610",
      ),
    ).toEqual({
      points: [],
      markers: [],
      avgCost: 610,
      sinceStart: "2026-03-02",
    });
  });

  it("'Desde tu compra' arranca 7 días antes de la primera operación del símbolo; sin operaciones, null", () => {
    const chart = buildPositionChart(
      series,
      [
        buy("2026-03-12T15:00:00Z", "VOO", "1", "620"),
        buy("2026-03-09T15:00:00Z", "VOO", "1", "610"),
        buy("2026-01-05T15:00:00Z", "AAPL", "1", "200"),
      ],
      "VOO",
      "615",
    );
    expect(chart.sinceStart).toBe("2026-03-02");
    // Los marcadores quedan en orden de fecha (el gráfico recorta por rango con eso).
    expect(chart.markers.map((m) => m.date)).toEqual(
      [...chart.markers.map((m) => m.date)].sort(),
    );
    expect(buildPositionChart(series, [], "VOO", null).sinceStart).toBeNull();
  });

  it("descarta puntos con cierres que no son números", () => {
    const chart = buildPositionChart(
      [
        { date: "2026-03-06", close: "abc" },
        { date: "2026-03-09", close: "610" },
      ],
      [],
      "VOO",
      null,
    );
    expect(chart.points).toEqual([{ date: "2026-03-09", close: 610 }]);
  });
});
