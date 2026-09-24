import { describe, expect, it } from "vitest";
import { computeEngine } from "../engine";
import { d, type Dec } from "../decimal";
import {
  pickPrice,
  valuePortfolio,
  type PriceInfo,
  type ValuedPortfolio,
} from "../valuation";
import { buy, deepFreeze, deposit, sell, split } from "./helpers";

const T0 = "2026-01-05T15:00:00Z";
const T1 = "2026-01-06T15:00:00Z";
const T2 = "2026-01-07T15:00:00Z";

/** Compara con `dp` decimales (los cocientes no exactos no caben en un string corto). */
function near(actual: Dec | null, expected: string, dp = 10): void {
  expect(actual).not.toBeNull();
  expect((actual as Dec).toDecimalPlaces(dp).toFixed()).toBe(
    d(expected).toDecimalPlaces(dp).toFixed(),
  );
}

function exact(actual: Dec | null, expected: string): void {
  expect(actual).not.toBeNull();
  expect((actual as Dec).toFixed()).toBe(d(expected).toFixed());
}

const price = (
  value: string,
  previousClose: string | null,
  source: PriceInfo["source"] = "quote",
): PriceInfo => ({
  price: d(value),
  asOf: new Date("2026-09-23T20:00:00Z"),
  source,
  previousClose: previousClose === null ? null : d(previousClose),
});

const bySymbol = (valued: ValuedPortfolio, symbol: string) => {
  const found = valued.positions.find((p) => p.symbol === symbol);
  if (!found) throw new Error(`sin posición ${symbol}`);
  return found;
};

describe("valuePortfolio: una posición con efectivo", () => {
  // 2000 depositados, VOO 10 a 100 (costo 1000) => efectivo 1000.
  const result = computeEngine([
    deposit(T0, "2000"),
    buy(T1, "VOO", "10", "100"),
  ]);
  const valued = valuePortfolio(
    result,
    new Map([["VOO", price("120", "110")]]),
  );

  it("valor, ganancia no realizada y peso de la posición", () => {
    const voo = bySymbol(valued, "VOO");
    exact(voo.marketValue, "1200");
    exact(voo.unrealizedPnl, "200");
    exact(voo.unrealizedPct, "0.2");
    near(voo.weight, "0.5454545455"); // 1200 / (1200 + 1000)
  });

  it("cambio del día de la posición: (120 − 110) × 10 = 100, sobre 1100", () => {
    const voo = bySymbol(valued, "VOO");
    exact(voo.dayChange, "100");
    near(voo.dayChangePct, "0.0909090909"); // 100 / 1100
  });

  it("totales del portafolio", () => {
    exact(valued.marketValue, "1200");
    exact(valued.cash, "1000");
    exact(valued.totalValue, "2200");
    exact(valued.unrealizedPnl, "200");
    exact(valued.unrealizedPct, "0.2");
    exact(valued.dayChange, "100");
    // El % del día es sobre el valor total del cierre anterior: 2200 − 100 = 2100 (incluye el efectivo).
    near(valued.dayChangePct, "0.0476190476"); // 100 / 2100
    expect(valued.missingPrices).toEqual([]);
  });

  it("conserva el precio, su fecha y su origen", () => {
    const voo = bySymbol(valued, "VOO");
    exact(voo.price, "120");
    expect(voo.priceAsOf).toEqual(new Date("2026-09-23T20:00:00Z"));
    expect(voo.priceSource).toBe("quote");
  });

  it("conserva los campos del libro mayor", () => {
    const voo = bySymbol(valued, "VOO");
    exact(voo.quantity, "10");
    exact(voo.costBasis, "1000");
    exact(voo.avgCost, "100");
    expect(voo.isOpen).toBe(true);
  });
});

describe("valuePortfolio: varias posiciones, una cerrada y una sin precio", () => {
  // AAA 10 a 100 con comisión 1 (costo 1001); BBB 5 a 50 (250); CCC 4 a 25 (100) vendida
  // entera a 30 con comisión 2 (realizado (120 − 2) − 100 = 18).
  const result = computeEngine([
    deposit(T0, "10000"),
    buy(T0, "AAA", "10", "100", "1"),
    buy(T0, "BBB", "5", "50"),
    buy(T0, "CCC", "4", "25"),
    sell(T1, "CCC", "4", "30", "2"),
  ]);
  // Efectivo: 10000 − 1001 − 250 − 100 + 118 = 8767.
  const valued = valuePortfolio(
    result,
    new Map([
      ["AAA", price("110", "105")],
      ["CCC", price("999", "999")], // cerrada: el precio se ignora
    ]),
  );

  it("la posición sin precio no se suma y queda listada", () => {
    expect(valued.missingPrices).toEqual(["BBB"]);
    const bbb = bySymbol(valued, "BBB");
    expect(bbb.marketValue).toBeNull();
    expect(bbb.unrealizedPnl).toBeNull();
    expect(bbb.weight).toBeNull();
    expect(bbb.price).toBeNull();
    exact(bbb.costBasis, "250"); // el costo sí se conserva
  });

  it("la cerrada no se valúa y conserva el realizado", () => {
    const ccc = bySymbol(valued, "CCC");
    expect(ccc.isOpen).toBe(false);
    expect(ccc.marketValue).toBeNull();
    expect(ccc.price).toBeNull();
    exact(ccc.realizedPnl, "18");
    expect(valued.missingPrices).not.toContain("CCC");
  });

  it("totales: solo cuenta lo que tiene precio", () => {
    exact(valued.marketValue, "1100");
    exact(valued.cash, "8767");
    exact(valued.totalValue, "9867");
    exact(valued.unrealizedPnl, "99"); // 1100 − 1001; BBB no entra
    near(valued.unrealizedPct, "0.0989010989"); // 99 / 1001
    exact(valued.realizedPnl, "18");
    exact(valued.dayChange, "50"); // (110 − 105) × 10
    near(valued.dayChangePct, "0.0050932057"); // 50 / (9867 − 50) = 50 / 9817
    near(bySymbol(valued, "AAA").weight, "0.1114827202"); // 1100 / 9867
  });
});

describe("valuePortfolio: bordes", () => {
  it("un split ya está en la cantidad del motor: se valúa la cantidad actual", () => {
    const result = computeEngine([
      buy(T0, "AAA", "10", "100"),
      split(T1, "AAA", "2"),
    ]);
    const valued = valuePortfolio(
      result,
      new Map([["AAA", price("60", "55")]]),
    );
    const aaa = bySymbol(valued, "AAA");
    exact(aaa.quantity, "20");
    exact(aaa.marketValue, "1200");
    exact(aaa.unrealizedPnl, "200"); // el costo (1000) no cambia con el split
    exact(aaa.dayChange, "100");
  });

  it("costo base 0: la ganancia es todo el valor y el % no se define", () => {
    const result = computeEngine([buy(T0, "GIFT", "10", "0")]);
    const gift = bySymbol(
      valuePortfolio(result, new Map([["GIFT", price("5", "4")]])),
      "GIFT",
    );
    exact(gift.unrealizedPnl, "50");
    expect(gift.unrealizedPct).toBeNull();
  });

  it("efectivo negativo: el valor total baja y, si queda en 0 o menos, no hay pesos", () => {
    const result = computeEngine([buy(T0, "AAA", "5", "100")]); // efectivo −500
    const valued = valuePortfolio(
      result,
      new Map([["AAA", price("40", "40")]]),
    );
    exact(valued.cash, "-500");
    exact(valued.totalValue, "-300"); // 200 − 500
    expect(bySymbol(valued, "AAA").weight).toBeNull();
    expect(valued.dayChangePct).toBeNull(); // la base (−300 − 0) no es positiva
  });

  it("sin cierre anterior no hay cambio del día", () => {
    const result = computeEngine([
      buy(T0, "AAA", "10", "100"),
      buy(T0, "BBB", "10", "100"),
    ]);
    const valued = valuePortfolio(
      result,
      new Map([
        ["AAA", price("110", null)],
        ["BBB", price("120", "115")],
      ]),
    );
    expect(bySymbol(valued, "AAA").dayChange).toBeNull();
    expect(bySymbol(valued, "AAA").dayChangePct).toBeNull();
    exact(valued.dayChange, "50"); // solo BBB: (120 − 115) × 10
  });

  it("si ninguna posición tiene cierre anterior, el cambio del día es null", () => {
    const result = computeEngine([buy(T0, "AAA", "10", "100")]);
    const valued = valuePortfolio(
      result,
      new Map([["AAA", price("110", null)]]),
    );
    expect(valued.dayChange).toBeNull();
    expect(valued.dayChangePct).toBeNull();
  });

  it("un día con precio sin cambio: cambio 0, no null", () => {
    const result = computeEngine([buy(T0, "AAA", "10", "100")]);
    const valued = valuePortfolio(
      result,
      new Map([["AAA", price("100", "100")]]),
    );
    exact(valued.dayChange, "0");
    exact(bySymbol(valued, "AAA").dayChangePct, "0");
  });

  it("libro vacío o sin precios: todo en cero y sin valores parciales", () => {
    const empty = valuePortfolio(computeEngine([]), new Map());
    expect(empty.positions).toEqual([]);
    exact(empty.totalValue, "0");
    exact(empty.marketValue, "0");
    expect(empty.unrealizedPct).toBeNull();
    expect(empty.dayChange).toBeNull();
    expect(empty.missingPrices).toEqual([]);

    const noPrices = valuePortfolio(
      computeEngine([deposit(T0, "100"), buy(T1, "AAA", "1", "50")]),
      new Map(),
    );
    exact(noPrices.totalValue, "50"); // solo el efectivo
    expect(noPrices.missingPrices).toEqual(["AAA"]);
    exact(noPrices.unrealizedPnl, "0");
    expect(noPrices.unrealizedPct).toBeNull();
  });

  it("cantidades fraccionarias: sin errores de float", () => {
    const result = computeEngine([buy(T2, "VOO", "8.95", "662.40")]);
    const voo = bySymbol(
      valuePortfolio(result, new Map([["VOO", price("707.6", "712.78")]])),
      "VOO",
    );
    exact(voo.marketValue, "5294.9708"); // 8.95 × 707.6
    exact(voo.dayChange, "-38.76194"); // (707.6 − 712.78) × 8.95 = −5.18 × 8.95
  });

  it("no muta el resultado del motor ni los precios", () => {
    const result = deepFreeze(
      computeEngine([deposit(T0, "1000"), buy(T1, "AAA", "10", "50")]),
    );
    const prices = deepFreeze(new Map([["AAA", price("60", "55")]]));
    expect(() => valuePortfolio(result, prices)).not.toThrow();
  });

  it("los issues del motor no afectan a la valuación (se informan aparte)", () => {
    const result = computeEngine([sell(T0, "AAA", "1", "10")]); // vender sin tener: error, sin posición
    const valued = valuePortfolio(result, new Map());
    expect(valued.positions).toEqual([]);
    expect(result.issues.some((i) => i.code === "SELL_EXCEEDS_HOLDINGS")).toBe(
      true,
    );
  });
});

describe("pickPrice", () => {
  const quote = (priceValue: string, change: string | null, asOf: string) => ({
    price: d(priceValue),
    change: change === null ? null : d(change),
    asOf: new Date(asOf),
  });
  const closes = (
    last: [string, string],
    prev: [string, string] | null = null,
  ) => ({
    last: { date: last[0], close: d(last[1]) },
    prev: prev ? { date: prev[0], close: d(prev[1]) } : null,
  });

  it("solo cotización: la usa y saca el cierre anterior de `change`", () => {
    const picked = pickPrice(
      quote("707.6", "-5.18", "2026-09-23T20:00:00Z"),
      null,
    );
    expect(picked?.source).toBe("quote");
    exact(picked?.price ?? null, "707.6");
    exact(picked?.previousClose ?? null, "712.78");
    expect(picked?.asOf).toEqual(new Date("2026-09-23T20:00:00Z"));
  });

  it("cotización sin `change` y sin cierres: no hay cierre anterior", () => {
    const picked = pickPrice(
      quote("707.6", null, "2026-09-23T20:00:00Z"),
      null,
    );
    expect(picked?.previousClose).toBeNull();
  });

  it("solo cierres: usa el último y muestra su fecha (a las 21:00 UTC)", () => {
    const picked = pickPrice(
      null,
      closes(["2026-09-23", "707.6"], ["2026-09-21", "712.78"]),
    );
    expect(picked?.source).toBe("close");
    exact(picked?.price ?? null, "707.6");
    exact(picked?.previousClose ?? null, "712.78");
    expect(picked?.asOf).toEqual(new Date("2026-09-23T21:00:00.000Z"));
  });

  it("un solo cierre no tiene cierre anterior", () => {
    expect(
      pickPrice(null, closes(["2026-09-23", "707.6"]))?.previousClose,
    ).toBeNull();
  });

  it("cotización del mismo día que el último cierre (mercado ya cerrado): gana la cotización", () => {
    const picked = pickPrice(
      quote("707.6", null, "2026-09-23T20:00:00Z"),
      closes(["2026-09-23", "707.6"], ["2026-09-22", "712.78"]),
    );
    expect(picked?.source).toBe("quote");
    // Sin `change`, el anterior es el penúltimo cierre.
    exact(picked?.previousClose ?? null, "712.78");
  });

  it("cotización de un día posterior (rueda en curso): el último cierre ES el anterior", () => {
    const picked = pickPrice(
      quote("710", null, "2026-09-24T15:00:00Z"),
      closes(["2026-09-23", "707.6"], ["2026-09-22", "712.78"]),
    );
    expect(picked?.source).toBe("quote");
    exact(picked?.price ?? null, "710");
    exact(picked?.previousClose ?? null, "707.6");
  });

  it("`change` del proveedor manda sobre lo que se deduzca de los cierres", () => {
    const picked = pickPrice(
      quote("710", "2.4", "2026-09-24T15:00:00Z"),
      closes(["2026-09-23", "999"], null),
    );
    exact(picked?.previousClose ?? null, "707.6"); // 710 − 2.4
  });

  it("cotización más vieja que el último cierre (quedó desactualizada): usa el cierre", () => {
    const picked = pickPrice(
      quote("700", "-1", "2026-09-22T20:00:00Z"),
      closes(["2026-09-23", "707.6"], ["2026-09-22", "703"]),
    );
    expect(picked?.source).toBe("close");
    exact(picked?.price ?? null, "707.6");
    exact(picked?.previousClose ?? null, "703");
  });

  it("fin de semana: la cotización del viernes y el cierre del viernes conviven", () => {
    const picked = pickPrice(
      quote("707.6", "-5.18", "2026-09-25T20:00:00Z"), // viernes
      closes(["2026-09-25", "707.6"], ["2026-09-24", "712.78"]),
    );
    expect(picked?.source).toBe("quote");
    exact(picked?.previousClose ?? null, "712.78");
  });

  it("un `change` que dejaría el cierre anterior en cero o negativo se descarta", () => {
    expect(
      pickPrice(quote("1", "2", "2026-09-23T20:00:00Z"), null)?.previousClose,
    ).toBeNull();
    expect(
      pickPrice(quote("1", "1", "2026-09-23T20:00:00Z"), null)?.previousClose,
    ).toBeNull();
  });

  it("`change` cero: el cierre anterior es el precio", () => {
    exact(
      pickPrice(quote("50", "0", "2026-09-23T20:00:00Z"), null)
        ?.previousClose ?? null,
      "50",
    );
  });

  it("sin cotización ni cierres: null", () => {
    expect(pickPrice(null, null)).toBeNull();
  });
});
