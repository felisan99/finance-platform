import { describe, expect, it } from "vitest";
import { d, ZERO, type Dec } from "../decimal";
import { buildDailySeries, closeOnOrBefore, type SeriesPoint } from "../series";
import type { DailyClose } from "../valuation";
import {
  buy,
  cashTx,
  deepFreeze,
  deposit,
  dividend,
  sell,
  split,
  withdrawal,
} from "./helpers";

// Calendario de referencia (setiembre de 2026, horario de verano de Nueva York, UTC−4):
// lun 21, mar 22, mié 23, jue 24, vie 25, sáb 26, dom 27, lun 28, mar 29, mié 30.
// Las operaciones van a las 15:00Z (11:00 en Nueva York): siempre caen en su día.

const at = (day: number, hour = "15:00:00") =>
  `2026-09-${String(day).padStart(2, "0")}T${hour}Z`;

/** `{ VOO: [["2026-09-21", "100"], …] }` → cierres por símbolo. */
function closesOf(
  spec: Record<string, ReadonlyArray<readonly [string, string]>>,
): Map<string, DailyClose[]> {
  return new Map(
    Object.entries(spec).map(([symbol, rows]) => [
      symbol,
      rows.map(([date, close]) => ({ date, close: d(close) })),
    ]),
  );
}

const values = (points: readonly SeriesPoint[]) =>
  points.map((p) => [p.date, p.value.toFixed()]);
const growths = (points: readonly SeriesPoint[]) =>
  points.map((p) => p.growth?.toFixed() ?? null);

function near(actual: Dec | null, expected: string, dp = 12): void {
  expect(actual).not.toBeNull();
  expect((actual as Dec).toDecimalPlaces(dp).toFixed()).toBe(
    d(expected).toDecimalPlaces(dp).toFixed(),
  );
}

describe("buildDailySeries: depósito a mitad de período", () => {
  // Lun: depósito 1000 y compra de 10 a 100 (V = 1000). Mar: cierre 110 (+10 %). Mié: depósito
  // 1100 y compra de 10 más a 110 (V = 20 × 110 = 2200). Jue: cierre 121 (+10 %).
  const series = buildDailySeries({
    transactions: [
      deposit(at(21), "1000"),
      buy(at(21), "VOO", "10", "100"),
      deposit(at(23), "1100"),
      buy(at(23), "VOO", "10", "110"),
    ],
    closes: closesOf({
      VOO: [
        ["2026-09-21", "100"],
        ["2026-09-22", "110"],
        ["2026-09-23", "110"],
        ["2026-09-24", "121"],
      ],
    }),
    endDate: "2026-09-24",
  });

  it("valor de cada día", () => {
    expect(values(series.points)).toEqual([
      ["2026-09-21", "1000"],
      ["2026-09-22", "1100"],
      ["2026-09-23", "2200"],
      ["2026-09-24", "2420"],
    ]);
  });

  it("flujo externo del día: solo los depósitos", () => {
    expect(series.points.map((p) => p.flow.toFixed())).toEqual([
      "1000",
      "0",
      "1100",
      "0",
    ]);
  });

  it("crecimiento diario con el flujo al inicio del día: V_t / (V_(t−1) + F_t)", () => {
    // Lun: 1000 / (0 + 1000) = 1. Mar: 1100 / 1000 = 1,1. Mié: 2200 / (1100 + 1100) = 1.
    // Jue: 2420 / 2200 = 1,1.
    expect(growths(series.points)).toEqual(["1", "1.1", "1", "1.1"]);
  });

  it("efectivo y valor de mercado por separado", () => {
    expect(series.points[3]!.cash.toFixed()).toBe("0");
    expect(series.points[3]!.marketValue.toFixed()).toBe("2420");
  });

  it("el día base es el hábil anterior al primero, y no hay avisos", () => {
    expect(series.baseDate).toBe("2026-09-18"); // viernes
    expect(series.unpricedSymbols).toEqual([]);
    expect(series.noBaseDays).toBe(0);
  });
});

describe("buildDailySeries: feriados y fines de semana", () => {
  // Mié: depósito 1000 y compra de 5 a 100 (efectivo 500). El sábado, un depósito de 500 que
  // cuenta el lunes. El lunes 28 no tiene cierre (feriado): se usa el del viernes.
  const series = buildDailySeries({
    transactions: [
      deposit(at(23), "1000"),
      buy(at(23), "VOO", "5", "100"),
      deposit(at(26), "500"),
    ],
    closes: closesOf({
      VOO: [
        ["2026-09-23", "100"],
        ["2026-09-24", "104"],
        ["2026-09-25", "106"],
        ["2026-09-29", "108"],
      ],
    }),
    endDate: "2026-09-29",
  });

  it("la grilla son solo días hábiles", () => {
    expect(series.points.map((p) => p.date)).toEqual([
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-28",
      "2026-09-29",
    ]);
  });

  it("el depósito del sábado cuenta el lunes", () => {
    expect(series.points.map((p) => p.flow.toFixed())).toEqual([
      "1000",
      "0",
      "0",
      "500",
      "0",
    ]);
  });

  it("sin cierre (feriado) se usa el último conocido, nunca cero", () => {
    // Mié 500 + 500 = 1000; jue 520 + 500; vie 530 + 500; lun (cierre del viernes: 530) + 1000;
    // mar 540 + 1000.
    expect(values(series.points)).toEqual([
      ["2026-09-23", "1000"],
      ["2026-09-24", "1020"],
      ["2026-09-25", "1030"],
      ["2026-09-28", "1530"],
      ["2026-09-29", "1540"],
    ]);
  });

  it("el lunes con depósito y sin movimiento de precio tiene crecimiento exacto 1", () => {
    // Base = V del viernes (1030) + depósito (500) = 1530 = V del lunes.
    expect(series.points[3]!.growth!.toFixed()).toBe("1");
    near(series.points[4]!.growth, String(1540 / 1530));
  });
});

describe("buildDailySeries: el día de mercado es el de Nueva York", () => {
  it("01:00Z del martes todavía es lunes a la noche en Nueva York", () => {
    // 2026-09-22T02:00Z = lun 21 22:00 EDT.
    const series = buildDailySeries({
      transactions: [deposit("2026-09-22T02:00:00Z", "100")],
      closes: closesOf({}),
      endDate: "2026-09-22",
    });
    expect(series.points.map((p) => p.date)).toEqual([
      "2026-09-21",
      "2026-09-22",
    ]);
    expect(series.points[0]!.flow.toFixed()).toBe("100");
  });

  it("recién a las 04:00Z (medianoche en Nueva York) pasa al día siguiente", () => {
    const before = buildDailySeries({
      transactions: [deposit("2026-09-22T03:59:59Z", "100")],
      closes: closesOf({}),
      endDate: "2026-09-22",
    });
    const after = buildDailySeries({
      transactions: [deposit("2026-09-22T04:00:00Z", "100")],
      closes: closesOf({}),
      endDate: "2026-09-22",
    });
    expect(before.points[0]!.date).toBe("2026-09-21");
    expect(after.points[0]!.date).toBe("2026-09-22");
  });
});

describe("buildDailySeries: splits del libro", () => {
  // 10 acciones a 100 (efectivo 9000). Split 2:1 el jueves. Los cierres guardados vienen
  // ajustados hacia atrás (los de antes del split, a la mitad); los reales serían 100, 102, 104,
  // 53 y 54. El valor no puede dar un salto por el split.
  const stored = {
    XYZ: [
      ["2026-09-21", "50"],
      ["2026-09-22", "51"],
      ["2026-09-23", "52"],
      ["2026-09-24", "53"],
      ["2026-09-25", "54"],
    ] as const,
  };
  const expected = [
    ["2026-09-21", "10000"], // 10 × 100 + 9000
    ["2026-09-22", "10020"], // 10 × 102 + 9000
    ["2026-09-23", "10040"], // 10 × 104 + 9000
    ["2026-09-24", "10060"], // 20 × 53 + 9000
    ["2026-09-25", "10080"], // 20 × 54 + 9000
  ];

  it("des-ajusta los cierres previos con la razón del split del libro", () => {
    const series = buildDailySeries({
      transactions: [
        deposit(at(21), "10000"),
        buy(at(21), "XYZ", "10", "100"),
        split(at(24), "XYZ", "2"),
      ],
      closes: closesOf(stored),
      endDate: "2026-09-25",
    });
    expect(values(series.points)).toEqual(expected);
  });

  it("si el split se cargó un día tarde no aparece un salto falso (cantidad y precio van en las mismas unidades)", () => {
    const series = buildDailySeries({
      transactions: [
        deposit(at(21), "10000"),
        buy(at(21), "XYZ", "10", "100"),
        split(at(25), "XYZ", "2"),
      ],
      closes: closesOf(stored),
      endDate: "2026-09-25",
    });
    // El jueves todavía hay 10 acciones: valen 53 × 2 = 106 cada una, igual que con el split a tiempo.
    expect(values(series.points)).toEqual(expected);
  });

  it("un split inverso (1 por 10) también", () => {
    // 100 acciones a 10 (efectivo 9000). Split inverso 0,1 el jueves: quedan 10. Reales: 10, 10,2,
    // 10,4 y, después del split, 108. Guardados (ajustados hacia atrás: los previos × 10): 100, 102,
    // 104 y 108.
    const series = buildDailySeries({
      transactions: [
        deposit(at(21), "10000"),
        buy(at(21), "XYZ", "100", "10"),
        split(at(24), "XYZ", "0.1"),
      ],
      closes: closesOf({
        XYZ: [
          ["2026-09-21", "100"],
          ["2026-09-22", "102"],
          ["2026-09-23", "104"],
          ["2026-09-24", "108"],
        ],
      }),
      endDate: "2026-09-24",
    });
    expect(values(series.points)).toEqual([
      ["2026-09-21", "10000"], // 100 × 10 + 9000
      ["2026-09-22", "10020"], // 100 × 10,2 + 9000
      ["2026-09-23", "10040"], // 100 × 10,4 + 9000
      ["2026-09-24", "10080"], // 10 × 108 + 9000
    ]);
  });
});

describe("buildDailySeries: ventas, dividendos y retiros", () => {
  // Lun: depósito 1000, compra de 10 a 50 (efectivo 500). Mar: dividendo de 20 y venta de 4 a 60
  // (efectivo 500 + 20 + 240 = 760, quedan 6). Mié: retiro de 200.
  const series = buildDailySeries({
    transactions: [
      deposit(at(21), "1000"),
      buy(at(21), "AAA", "10", "50"),
      dividend(at(22), "AAA", "20"),
      sell(at(22), "AAA", "4", "60"),
      withdrawal(at(23), "200"),
    ],
    closes: closesOf({
      AAA: [
        ["2026-09-21", "50"],
        ["2026-09-22", "60"],
        ["2026-09-23", "60"],
      ],
    }),
    endDate: "2026-09-23",
  });

  it("valores", () => {
    expect(values(series.points)).toEqual([
      ["2026-09-21", "1000"], // 10 × 50 + 500
      ["2026-09-22", "1120"], // 6 × 60 + 760
      ["2026-09-23", "920"], // 6 × 60 + 560
    ]);
  });

  it("el dividendo y la venta no son flujos externos: son rendimiento", () => {
    expect(series.points.map((p) => p.flow.toFixed())).toEqual([
      "1000",
      "0",
      "-200",
    ]);
    // Martes: 1120 / (1000 + 0) = 1,12.
    expect(growths(series.points)).toEqual(["1", "1.12", "1"]);
  });

  it("el retiro va en la base del día: 920 / (1120 − 200) = 1", () => {
    expect(series.points[2]!.growth!.toFixed()).toBe("1");
  });

  it("intereses, comisiones e impuestos tampoco son flujos", () => {
    const other = buildDailySeries({
      transactions: [
        deposit(at(21), "1000"),
        cashTx("INTEREST", at(22), "5"),
        cashTx("FEE", at(22), "2"),
        cashTx("TAX", at(22), "1"),
      ],
      closes: closesOf({}),
      endDate: "2026-09-22",
    });
    expect(other.points.map((p) => p.flow.toFixed())).toEqual(["1000", "0"]);
    expect(values(other.points)).toEqual([
      ["2026-09-21", "1000"],
      ["2026-09-22", "1002"],
    ]);
  });

  it("una posición cerrada ya no necesita precio", () => {
    const closed = buildDailySeries({
      transactions: [
        deposit(at(21), "1000"),
        buy(at(21), "AAA", "10", "50"),
        sell(at(22), "AAA", "10", "60"),
      ],
      closes: closesOf({ AAA: [["2026-09-21", "50"]] }),
      endDate: "2026-09-23",
    });
    expect(closed.unpricedSymbols).toEqual([]);
    expect(values(closed.points)).toEqual([
      ["2026-09-21", "1000"],
      ["2026-09-22", "1100"], // efectivo 500 + 600
      ["2026-09-23", "1100"],
    ]);
  });
});

describe("buildDailySeries: datos incompletos", () => {
  it("una posición sin ningún cierre anterior se valúa a su costo y se avisa", () => {
    // Z: 4 a 100 con comisión 2 (costo 402, efectivo 598). El primer cierre llega el miércoles.
    const series = buildDailySeries({
      transactions: [
        deposit(at(21), "1000"),
        buy(at(21), "Z", "4", "100", "2"),
      ],
      closes: closesOf({ Z: [["2026-09-23", "110"]] }),
      endDate: "2026-09-23",
    });
    expect(values(series.points)).toEqual([
      ["2026-09-21", "1000"], // 402 + 598
      ["2026-09-22", "1000"],
      ["2026-09-23", "1038"], // 4 × 110 + 598
    ]);
    expect(series.points.map((p) => p.unpriced)).toEqual([["Z"], ["Z"], []]);
    expect(series.unpricedSymbols).toEqual(["Z"]);
  });

  it("un día con base ≤ 0 no aporta retorno y se cuenta", () => {
    // Lun: se compra antes de depositar (efectivo −100, V = 100 − 100 = 0). Mar: depósito de 200.
    const series = buildDailySeries({
      transactions: [buy(at(21), "AAA", "1", "100"), deposit(at(22), "200")],
      closes: closesOf({
        AAA: [
          ["2026-09-21", "100"],
          ["2026-09-22", "100"],
        ],
      }),
      endDate: "2026-09-22",
    });
    expect(growths(series.points)).toEqual([null, "1"]);
    expect(series.noBaseDays).toBe(1);
  });

  it("una operación rechazada por el motor no cuenta como flujo", () => {
    const series = buildDailySeries({
      transactions: [
        deposit(at(21), "1000"),
        { ...deposit(at(22), "500"), currency: "EUR" },
      ],
      closes: closesOf({}),
      endDate: "2026-09-22",
    });
    expect(series.points.map((p) => p.flow.toFixed())).toEqual(["1000", "0"]);
    expect(values(series.points)[1]).toEqual(["2026-09-22", "1000"]);
  });
});

describe("buildDailySeries: bordes de la entrada", () => {
  it("sin operaciones no hay serie", () => {
    const series = buildDailySeries({
      transactions: [],
      closes: closesOf({}),
      endDate: "2026-09-24",
    });
    expect(series).toEqual({
      points: [],
      baseDate: null,
      unpricedSymbols: [],
      noBaseDays: 0,
    });
  });

  it("las operaciones posteriores al día final no se aplican", () => {
    const series = buildDailySeries({
      transactions: [deposit(at(21), "1000"), deposit(at(28), "500")],
      closes: closesOf({}),
      endDate: "2026-09-25",
    });
    expect(series.points.at(-1)!.date).toBe("2026-09-25");
    expect(series.points.at(-1)!.value.toFixed()).toBe("1000");
    // Y si todas son posteriores, no hay serie.
    expect(
      buildDailySeries({
        transactions: [deposit(at(28), "500")],
        closes: closesOf({}),
        endDate: "2026-09-25",
      }).points,
    ).toEqual([]);
  });

  it("un día final de fin de semana es el último punto (cripto): después del viernes, el domingo", () => {
    const series = buildDailySeries({
      transactions: [deposit(at(24), "1000")],
      closes: closesOf({}),
      endDate: "2026-09-27",
    });
    expect(series.points.map((p) => p.date)).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-27",
    ]);
  });

  it("el fin de semana final: la cripto con su cierre del domingo, la acción con el del viernes", () => {
    const series = buildDailySeries({
      transactions: [
        deposit(at(24), "1000"),
        buy(at(24), "BTC-USD", "0.01", "50000"),
        buy(at(24), "VOO", "1", "100"),
        // Un depósito del sábado cuenta en el domingo final, no el lunes que todavía no existe.
        deposit(at(26), "200"),
      ],
      closes: closesOf({
        "BTC-USD": [
          ["2026-09-24", "50000"],
          ["2026-09-25", "51000"],
          ["2026-09-26", "52000"],
          ["2026-09-27", "53000"],
        ],
        VOO: [
          ["2026-09-24", "100"],
          ["2026-09-25", "101"],
        ],
      }),
      endDate: "2026-09-27",
    });
    expect(
      series.points.map((p) => [p.date, p.value.toFixed(), p.flow.toFixed()]),
    ).toEqual([
      ["2026-09-24", "1000", "1000"], // 400 + 500 + 100
      ["2026-09-25", "1011", "0"], // 400 + 510 + 101
      ["2026-09-27", "1231", "200"], // 600 + 530 + 101
    ]);
    // Si la serie sigue hasta el lunes, el domingo deja de ser un punto y el depósito vale el lunes.
    const monday = buildDailySeries({
      transactions: [deposit(at(24), "1000"), deposit(at(26), "200")],
      closes: closesOf({}),
      endDate: "2026-09-28",
    });
    expect(monday.points.map((p) => [p.date, p.flow.toFixed()])).toEqual([
      ["2026-09-24", "1000"],
      ["2026-09-25", "0"],
      ["2026-09-28", "200"],
    ]);
  });

  it("una serie que empieza y termina el mismo fin de semana tiene un solo punto", () => {
    const series = buildDailySeries({
      transactions: [deposit(at(26), "300")],
      closes: closesOf({}),
      endDate: "2026-09-27",
    });
    expect(series.points.map((p) => p.date)).toEqual(["2026-09-27"]);
    expect(series.baseDate).toBe("2026-09-25");
    expect(series.points[0]!.growth?.toFixed()).toBe("1");
  });

  it("no importa el orden de las operaciones ni el de los cierres", () => {
    const txs = [
      deposit(at(21), "1000"),
      buy(at(21), "AAA", "10", "50"),
      sell(at(23), "AAA", "3", "60"),
      withdrawal(at(23), "100"),
    ];
    const rows = [
      ["2026-09-21", "50"],
      ["2026-09-22", "55"],
      ["2026-09-23", "60"],
    ] as const;
    const straight = buildDailySeries({
      transactions: txs,
      closes: closesOf({ AAA: rows }),
      endDate: "2026-09-23",
    });
    const shuffled = buildDailySeries({
      transactions: [txs[3]!, txs[1]!, txs[2]!, txs[0]!],
      closes: closesOf({ AAA: [rows[2], rows[0], rows[1]] }),
      endDate: "2026-09-23",
    });
    expect(values(shuffled.points)).toEqual(values(straight.points));
    expect(growths(shuffled.points)).toEqual(growths(straight.points));
  });

  it("no muta sus entradas", () => {
    const input = deepFreeze({
      transactions: [deposit(at(21), "1000"), buy(at(21), "AAA", "1", "100")],
      closes: closesOf({ AAA: [["2026-09-21", "100"]] }),
      endDate: "2026-09-22",
    });
    expect(() => buildDailySeries(input)).not.toThrow();
  });
});

describe("closeOnOrBefore", () => {
  const list: DailyClose[] = [
    { date: "2026-09-21", close: d("1") },
    { date: "2026-09-23", close: d("2") },
    { date: "2026-09-25", close: d("3") },
  ];
  it("el cierre de la fecha o el anterior más cercano", () => {
    expect(closeOnOrBefore(list, "2026-09-23")!.close.toFixed()).toBe("2");
    expect(closeOnOrBefore(list, "2026-09-24")!.close.toFixed()).toBe("2");
    expect(closeOnOrBefore(list, "2026-12-31")!.close.toFixed()).toBe("3");
    expect(closeOnOrBefore(list, "2026-09-21")!.close.toFixed()).toBe("1");
  });
  it("null si no hay ninguno anterior o la lista está vacía", () => {
    expect(closeOnOrBefore(list, "2026-09-20")).toBeNull();
    expect(closeOnOrBefore([], "2026-09-24")).toBeNull();
  });
  it("ZERO no se usa como respaldo", () => {
    expect(closeOnOrBefore([], "2026-09-24")).not.toEqual({
      date: "2026-09-24",
      close: ZERO,
    });
  });
});
