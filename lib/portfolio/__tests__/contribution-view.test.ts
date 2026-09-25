import { describe, expect, it } from "vitest";
import { computeEngine, d, valuePortfolio, type PriceInfo } from "@/lib/engine";
import {
  buy,
  cashTx,
  deposit,
  dividend,
  sell,
} from "@/lib/engine/__tests__/helpers";
import { buildContributionView, MAX_NAMED_ROWS } from "../contribution-view";
import { buildDashboard } from "../dashboard";

// "Ganancia por posición" de Inicio. Números a mano.

/** El formato es-UY separa `US$` del número con un espacio duro: se normaliza para leer el test. */
const plain = (text: string) => text.replaceAll("\u00a0", " ");

const T = "2026-01-05T15:00:00Z";
const NOW = new Date("2026-09-24T18:00:00Z");

const price = (value: string, previous: string | null): PriceInfo => ({
  price: d(value),
  asOf: new Date("2026-09-23T20:00:00Z"),
  source: "quote",
  previousClose: previous === null ? null : d(previous),
});

function view(
  txs: Parameters<typeof computeEngine>[0],
  prices: Map<string, PriceInfo>,
) {
  const result = computeEngine(txs);
  const valued = valuePortfolio(result, prices);
  return {
    valued,
    result,
    contribution: buildContributionView(valued, result.totals),
  };
}

describe("modo Total", () => {
  // AAA: costo 1000, a 110 → +100. BBB: 500 → 450 = −50. CCC: 200 → 300 = +100. DDD: sin cambio.
  // OLD: cerrada con 20 realizados. NOPRICE: abierta sin precio.
  const { contribution } = view(
    [
      deposit(T, "100000"),
      buy(T, "AAA", "10", "100"),
      buy(T, "BBB", "10", "50"),
      buy(T, "CCC", "10", "20"),
      buy(T, "DDD", "10", "10"),
      buy(T, "NOPRICE", "10", "8"),
      buy(T, "OLD", "5", "10"),
      sell("2026-02-05T15:00:00Z", "OLD", "5", "14"),
    ],
    new Map([
      ["AAA", price("110", "100")],
      ["BBB", price("45", "50")],
      ["CCC", price("30", "25")],
      ["DDD", price("10", "10")],
    ]),
  );
  const rows = contribution.total.rows;

  it("de la que más ganó a la que más perdió, con empates por símbolo, y con las cerradas", () => {
    expect(rows.map((r) => [r.label, plain(r.text)])).toEqual([
      ["AAA", "+US$ 100,00"],
      ["CCC", "+US$ 100,00"],
      ["OLD", "+US$ 20,00"],
      ["DDD", "US$ 0,00"],
      ["BBB", "-US$ 50,00"],
    ]);
    expect(rows.find((r) => r.label === "OLD")!.closed).toBe(true);
    expect(rows.find((r) => r.label === "AAA")!.closed).toBe(false);
  });

  it("el tono sale del signo tal como se ve (cero = sin cambio)", () => {
    expect(rows.map((r) => r.tone)).toEqual([
      "gain",
      "gain",
      "gain",
      "flat",
      "loss",
    ]);
  });

  it("la proporción es sobre el mayor valor absoluto (100)", () => {
    expect(rows.map((r) => r.ratio)).toEqual([1, 1, 0.2, 0, -0.5]);
  });

  it("una posición abierta sin precio no entra y se avisa", () => {
    expect(rows.some((r) => r.label === "NOPRICE")).toBe(false);
    expect(contribution.total.note).toBe(
      "Sin precio: NOPRICE. No entra en la suma.",
    );
  });

  it("la suma de las filas: 100 + 100 + 20 + 0 − 50 = 170", () => {
    expect(plain(contribution.total.totalText)).toBe("+US$ 170,00");
    expect(contribution.total.totalTone).toBe("gain");
  });

  it("cada fila de símbolo lleva el enlace a su detalle", () => {
    expect(rows[0]!.href).toBe("/positions/AAA");
  });
});

describe("los dividendos suman a su símbolo", () => {
  it("no realizado 10 + dividendo 5 = 15", () => {
    const { contribution } = view(
      [
        deposit(T, "1000"),
        buy(T, "VOO", "1", "100"),
        dividend("2026-03-01T15:00:00Z", "VOO", "5"),
      ],
      new Map([["VOO", price("110", "110")]]),
    );
    expect(contribution.total.rows.map((r) => plain(r.text))).toEqual([
      "+US$ 15,00",
    ]);
  });
});

describe("la suma coincide con la ganancia total del hero", () => {
  it("con comisiones, intereses, impuestos, un retiro y ventas parciales", () => {
    const txs = [
      deposit(T, "5000"),
      buy(T, "AAA", "10", "100", "2"),
      sell("2026-01-06T15:00:00Z", "AAA", "4", "120", "1"),
      dividend("2026-01-07T15:00:00Z", "AAA", "3"),
      cashTx("FEE", "2026-01-08T15:00:00Z", "5"),
      cashTx("INTEREST", "2026-01-09T15:00:00Z", "2"),
      cashTx("TAX", "2026-01-10T15:00:00Z", "1"),
      cashTx("WITHDRAWAL", "2026-01-11T15:00:00Z", "500"),
    ];
    const { valued, contribution } = view(
      txs,
      new Map([["AAA", price("110", "110")]]),
    );
    // AAA: 78,2 realizado + 58,8 no realizado + 3 de dividendo = 140. Otros: 2 − 5 − 1 = −4.
    expect(
      contribution.total.rows.map((r) => [r.label, plain(r.text)]),
    ).toEqual([
      ["AAA", "+US$ 140,00"],
      ["Comisiones y otros", "-US$ 4,00"],
    ]);
    const dashboard = buildDashboard(valued, txs, NOW);
    expect(dashboard.totalGain!.toFixed()).toBe("136");
    expect(plain(contribution.total.totalText)).toBe("+US$ 136,00");
  });

  it("sin comisiones ni intereses no hay fila de 'otros'", () => {
    const { contribution } = view(
      [deposit(T, "1000"), buy(T, "AAA", "1", "100")],
      new Map([["AAA", price("100", "100")]]),
    );
    expect(contribution.total.rows.map((r) => r.label)).toEqual(["AAA"]);
  });
});

describe("tope de filas", () => {
  it(`muestra ${MAX_NAMED_ROWS} y agrupa el resto en 'Otras (n)' con su suma`, () => {
    // Diez posiciones que ganan 10, 9, …, 1 dólares.
    const symbols = "ABCDEFGHIJ".split("");
    const txs = [
      deposit(T, "100000"),
      ...symbols.map((s) => buy(T, s, "1", "100")),
    ];
    const prices = new Map(
      symbols.map((s, i) => [s, price(String(110 - i), "100")] as const),
    );
    const { contribution } = view(txs, prices);
    const rows = contribution.total.rows;
    expect(rows).toHaveLength(MAX_NAMED_ROWS + 1);
    expect(rows.slice(0, MAX_NAMED_ROWS).map((r) => r.label)).toEqual(
      symbols.slice(0, MAX_NAMED_ROWS),
    );
    // Las dos últimas ganan 2 y 1: "Otras (2)" suma 3.
    expect(rows.at(-1)).toMatchObject({ label: "Otras (2)", href: null });
    expect(plain(rows.at(-1)!.text)).toBe("+US$ 3,00");
    // La suma incluye lo agrupado: 10 + 9 + … + 1 = 55.
    expect(plain(contribution.total.totalText)).toBe("+US$ 55,00");
  });
});

describe("modo Hoy", () => {
  it("solo posiciones abiertas con cierre anterior, en dinero y ordenadas", () => {
    const { contribution } = view(
      [
        deposit(T, "100000"),
        buy(T, "AAA", "10", "100"),
        buy(T, "BBB", "10", "50"),
        buy(T, "NOPREV", "1", "10"),
        buy(T, "OLD", "5", "10"),
        sell("2026-02-05T15:00:00Z", "OLD", "5", "14"),
      ],
      new Map([
        ["AAA", price("110", "100")], // +10 × 10 = +100
        ["BBB", price("45", "50")], // −5 × 10 = −50
        ["NOPREV", price("12", null)], // sin cierre anterior: no entra
      ]),
    );
    expect(contribution.day.rows.map((r) => [r.label, plain(r.text)])).toEqual([
      ["AAA", "+US$ 100,00"],
      ["BBB", "-US$ 50,00"],
    ]);
    expect(plain(contribution.day.totalText)).toBe("+US$ 50,00");
    expect(contribution.day.rows.map((r) => r.ratio)).toEqual([1, -0.5]);
    expect(contribution.day.note).toBeNull();
  });

  it("todo en cero: barras vacías y sin división por cero", () => {
    const { contribution } = view(
      [deposit(T, "1000"), buy(T, "AAA", "1", "10")],
      new Map([["AAA", price("10", "10")]]),
    );
    expect(contribution.day.rows.map((r) => r.ratio)).toEqual([0]);
    expect(contribution.day.rows[0]!.tone).toBe("flat");
  });
});

describe("portafolio vacío", () => {
  it("no hay filas ni tono", () => {
    const { contribution } = view([], new Map());
    for (const mode of [contribution.total, contribution.day]) {
      expect(mode.rows).toEqual([]);
      expect(mode.totalTone).toBeNull();
    }
  });
});

describe("el tope no esconde las pérdidas grandes", () => {
  it("con nombre quedan las de mayor peso, ganando o perdiendo; en 'Otras' las más chicas", () => {
    // A…H ganan 10, 9, …, 3; I pierde 20 y J pierde 1.
    const gains: Array<[string, string]> = [
      ["A", "110"],
      ["B", "109"],
      ["C", "108"],
      ["D", "107"],
      ["E", "106"],
      ["F", "105"],
      ["G", "104"],
      ["H", "103"],
      ["I", "80"],
      ["J", "99"],
    ];
    const txs = [
      deposit(T, "100000"),
      ...gains.map(([s]) => buy(T, s, "1", "100")),
    ];
    const prices = new Map(
      gains.map(([s, p]) => [s, price(p, "100")] as const),
    );
    const rows = view(txs, prices).contribution.total.rows;
    // Las 8 de mayor valor absoluto: I (20), A … G (10 … 4). H (3) y J (−1) van juntas: +2.
    expect(rows.map((r) => r.label)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "I",
      "Otras (2)",
    ]);
    expect(plain(rows.at(-1)!.text)).toBe("+US$ 2,00");
    expect(plain(rows.find((r) => r.label === "I")!.text)).toBe("-US$ 20,00");
    // La proporción usa la mayor magnitud (20): la pérdida grande llena media barra.
    expect(rows.find((r) => r.label === "I")!.ratio).toBe(-1);
    expect(rows.find((r) => r.label === "A")!.ratio).toBe(0.5);
  });
});
