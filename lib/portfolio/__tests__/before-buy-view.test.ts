import { describe, expect, it } from "vitest";
import {
  addDays,
  computeEngine,
  d,
  isWeekday,
  valuePortfolio,
  type DailyClose,
  type PriceInfo,
  type Transaction,
} from "@/lib/engine";
import { buy, deposit } from "@/lib/engine/__tests__/helpers";
import {
  MAX_CHART_POINTS,
  amountOptions,
  buildBeforeBuyView,
  fitSentence,
  sectorLabel,
  type BeforeBuyInput,
} from "../before-buy-view";

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

const TODAY = "2026-09-28";
const END = "2026-09-25"; // viernes: el último cierre

/** Un cierre por día hábil de `from` a `to`, con el precio que devuelve `price(i)`. */
function series(
  from: string,
  to: string,
  price: (i: number) => number,
): DailyClose[] {
  const out: DailyClose[] = [];
  let i = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (!isWeekday(day)) continue;
    out.push({ date: day, close: d(price(i).toFixed(4)) });
    i += 1;
  }
  return out;
}

// Un activo que sube, se hunde a la mitad y se recupera; otro que sube parejo.
const wave = (i: number) => 100 * (1 + 0.5 * Math.sin(i / 90)) + i * 0.05;
const steady = (i: number) => 400 + i * 0.1;
const wobble = (seed: number) => (i: number) =>
  100 + 10 * Math.sin(i / (7 + seed)) + 3 * Math.cos(i / (3 + seed)) + i * 0.02;

const FIVE_YEARS_AGO = "2021-09-20";

function price(value: string): PriceInfo {
  return {
    price: d(value),
    asOf: new Date(`${END}T21:00:00Z`),
    source: "close",
    previousClose: null,
  };
}

/** AAPL 10 × 100 y VOO 5 × 400, depositando US$ 1.000 por mes los últimos 4 meses. */
function portfolio(): {
  transactions: Transaction[];
  input: Pick<BeforeBuyInput, "valued" | "transactions" | "holdingCloses">;
} {
  const transactions: Transaction[] = [
    deposit("2026-01-02T15:00:00Z", "2000"),
    buy("2026-01-05T15:00:00Z", "AAPL", "10", "100"),
    buy("2026-01-05T15:00:00Z", "VOO", "5", "400"),
    ...["2026-06", "2026-07", "2026-08", "2026-09"].map((m) =>
      deposit(`${m}-03T15:00:00Z`, "1000"),
    ),
  ];
  // Efectivo: 2.000 + 4 × 1.000 − 3.000 = 3.000.
  const valued = valuePortfolio(
    computeEngine(transactions),
    new Map([
      ["AAPL", price("100")],
      ["VOO", price("400")],
    ]),
  );
  return {
    transactions,
    input: {
      valued,
      transactions,
      holdingCloses: new Map([
        ["AAPL", series("2025-09-15", END, wobble(1))],
        ["VOO", series("2025-09-15", END, wobble(5))],
      ]),
    },
  };
}

const GROUPS: Record<string, string> = {
  AAPL: "Technology",
  NVDA: "Technology",
  VOO: "ETF",
  SPY: "ETF",
};

function input(patch: Partial<BeforeBuyInput> = {}): BeforeBuyInput {
  return {
    symbol: "NVDA",
    ...portfolio().input,
    groupOf: (symbol) => GROUPS[symbol] ?? null,
    candidateCloses: series(FIVE_YEARS_AGO, END, wave),
    benchmark: { symbol: "SPY", closes: series(FIVE_YEARS_AGO, END, steady) },
    today: TODAY,
    ...patch,
  };
}

describe("amountOptions", () => {
  it("sin depósitos: los cuatro fijos y arranca en US$ 1.000", () => {
    const result = amountOptions(null);
    expect(result.options.map((o) => plain(o.text))).toEqual([
      "US$ 500",
      "US$ 1.000",
      "US$ 2.000",
      "US$ 5.000",
    ]);
    expect(result.defaultId).toBe("1000");
    expect(result.note).toMatch(/^Sin depósitos/);
  });

  it("un aporte típico que coincide con un fijo no lo duplica", () => {
    const result = amountOptions(d("2000"));
    expect(result.options.map((o) => o.id)).toEqual([
      "500",
      "1000",
      "2000",
      "5000",
    ]);
    expect(result.defaultId).toBe("2000");
    expect(plain(result.note)).toContain("tu aporte típico, US$ 2.000");
  });

  it("un aporte típico distinto reemplaza al fijo más cercano (redondeado al dólar)", () => {
    const result = amountOptions(d("1234.5"));
    expect(result.options.map((o) => o.id)).toEqual([
      "500",
      "1235",
      "2000",
      "5000",
    ]);
    expect(result.defaultId).toBe("1235");
    expect(result.options.find((o) => o.id === "1235")?.value).toBe(1235);
  });

  it("un aporte típico de menos de un dólar no cuenta", () => {
    expect(amountOptions(d("0.4")).defaultId).toBe("1000");
  });
});

describe("sectorLabel", () => {
  it("traduce los sectores de Yahoo y deja tal cual uno desconocido", () => {
    expect(sectorLabel("Technology")).toBe("Tecnología");
    expect(sectorLabel("ETF")).toBe("ETFs");
    expect(sectorLabel("Quantum")).toBe("Quantum");
  });
});

describe("fitSentence", () => {
  it.each([
    [0.95, /^Se mueve casi igual/],
    [0.8, /^Se mueve casi igual/],
    [0.79, /^Se parece bastante/],
    [0.5, /^Se parece bastante/],
    [0.49, /^Se mueve bastante distinto/],
    [0, /^Se mueve bastante distinto/],
    [-0.01, /^Tiende a moverse al revés/],
  ])("%s", (value, expected) => {
    expect(fitSentence(value)).toMatch(expected);
  });
});

describe("buildBeforeBuyView: qué le hace a tu cartera", () => {
  const view = buildBeforeBuyView(input())!;

  it("el aporte típico sale de los depósitos (US$ 1.000 por mes)", () => {
    expect(view.defaultAmountId).toBe("1000");
  });

  it("las filas de antes y después para cada monto", () => {
    const rows = view.impact!.byAmount["1000"]!;
    // Antes: AAPL 1.000, VOO 2.000, efectivo 3.000 → total 6.000; después 7.000.
    expect(rows.map((r) => [r.label, plain(r.before), plain(r.after)])).toEqual(
      [
        ["NVDA en tu cartera", "0,00%", "14,29%"],
        ["Tecnología", "16,67%", "28,57%"],
        ["Volatilidad (1 año)", rows[2]!.before, rows[2]!.after].map(plain),
      ],
    );
    expect(view.impact!.byAmount["5000"]![0]!.after).toMatch(/45,45/);
  });

  it("con 3 posiciones o menos no muestra «Tus 3 posiciones más grandes»", () => {
    const labels = view.impact!.byAmount["1000"]!.map((r) => r.label);
    expect(labels).not.toContain("Tus 3 posiciones más grandes");
  });

  it("el parecido lleva la correlación, una frase y lo que más se le parece", () => {
    expect(view.impact!.fit!.value).toMatch(/^-?\d,\d\d$/);
    expect(view.impact!.fit!.sentence.length).toBeGreaterThan(10);
    expect(view.impact!.fit!.closest).toMatch(
      /^Lo que más se le parece: (AAPL|VOO) \(/,
    );
  });

  it("sin cartera todavía, no hay sección de impacto pero sí la simulación", () => {
    const empty = buildBeforeBuyView(
      input({
        valued: valuePortfolio(computeEngine([]), new Map()),
        transactions: [],
        holdingCloses: new Map(),
      }),
    )!;
    expect(empty.impact).toBeNull();
    expect(empty.windows.length).toBeGreaterThan(0);
    const none = buildBeforeBuyView(input({ valued: null, transactions: [] }))!;
    expect(none.impact).toBeNull();
  });

  it("avisa qué posición recorta la ventana y cuál no tiene historia", () => {
    const base = portfolio().input;
    const recent = buildBeforeBuyView(
      input({
        holdingCloses: new Map([
          ["AAPL", series("2026-03-02", END, wobble(1))],
          ["VOO", []],
        ]),
        valued: base.valued,
      }),
    )!;
    expect(recent.impact!.notes).toContain(
      "Con poca historia: AAPL (desde el 02/03/2026) no entra en la volatilidad ni en el parecido.",
    );
    expect(recent.impact!.notes).toContain(
      "Sin cierres del último año: VOO (no entra en la volatilidad ni en el parecido).",
    );
  });

  it("con poca historia en común, en vez del parecido explica por qué no está", () => {
    const short = buildBeforeBuyView(
      input({ candidateCloses: series("2026-08-03", END, wave) }),
    )!;
    expect(short.impact!.fit).toBeNull();
    expect(short.impact!.notes).toContain(
      "Con datos desde el 03/08/2026: NVDA no tiene más historia.",
    );
    expect(short.impact!.notes[0]).toMatch(
      /hacen falta 60 ruedas en común; hay \d+\./,
    );
    expect(short.impact!.byAmount["1000"]!.map((r) => r.label)).not.toContain(
      "Volatilidad (1 año)",
    );
  });

  it("si el candidato es la única posición, no hay con qué compararlo", () => {
    const transactions = [
      deposit("2026-01-02T15:00:00Z", "1000"),
      buy("2026-01-05T15:00:00Z", "NVDA", "10", "100"),
    ];
    const only = buildBeforeBuyView(
      input({
        transactions,
        valued: valuePortfolio(
          computeEngine(transactions),
          new Map([["NVDA", price("100")]]),
        ),
        holdingCloses: new Map([["NVDA", series("2025-09-15", END, wave)]]),
      }),
    )!;
    expect(only.impact!.fit).toBeNull();
    expect(only.impact!.notes).toContain(
      "No hay otra posición con la que compararlo.",
    );
    expect(only.impact!.byAmount["1000"]![0]!.label).toBe("NVDA en tu cartera");
  });
});

describe("buildBeforeBuyView: ¿lo habrías aguantado?", () => {
  const view = buildBeforeBuyView(input())!;

  it("con 5 años de historia: 1, 3 y 5 años, y arranca en el más largo", () => {
    expect(view.windows.map((w) => w.id)).toEqual(["1A", "3A", "5A"]);
    expect(view.windows.map((w) => w.label)).toEqual([
      "1 año",
      "3 años",
      "5 años",
    ]);
    expect(view.defaultWindowId).toBe("5A");
    // Cada período arranca el 1.º del mes siguiente: 12, 36 y 60 aportes justos.
    expect(
      view.windows.map(
        (w) => /\((\d+) aportes\)/.exec(w.plans["1000"]!.heading)![1],
      ),
    ).toEqual(["12", "36", "60"]);
    expect(view.asOf).toBe("25/09/2026");
  });

  it("el texto del plan escala con el monto", () => {
    const year = view.windows[0]!;
    const one = year.plans["1000"]!;
    expect(plain(one.heading)).toMatch(
      /^US\$ 1\.000 por mes desde octubre de 2025 \(12 aportes\)$/,
    );
    const contributions = Number(/\((\d+) aportes\)/.exec(one.heading)![1]);
    expect(plain(one.invested)).toBe(
      `US$ ${(contributions * 1000).toLocaleString("es-UY")},00`.replace(
        / /g,
        " ",
      ),
    );
    const five = year.plans["5000"]!;
    expect(plain(five.invested)).toBe(
      `US$ ${(contributions * 5000).toLocaleString("es-UY")},00`.replace(
        / /g,
        " ",
      ),
    );
    expect(one.gain.text).toBe(five.gain.text); // el porcentaje no depende del monto
  });

  it("compara contra el benchmark, salvo que el candidato sea el benchmark", () => {
    expect(view.benchmarkLabel).toBe("S&P 500");
    expect(view.windows[0]!.plans["1000"]!.benchmark!.text).toMatch(
      /^Lo mismo en S&P 500: US\$/,
    );
    const spy = buildBeforeBuyView(
      input({
        symbol: "SPY",
        candidateCloses: series(FIVE_YEARS_AGO, END, steady),
      }),
    )!;
    expect(spy.benchmarkLabel).toBeNull();
    expect(spy.windows[0]!.plans["1000"]!.benchmark).toBeNull();
  });

  it("el peor momento, su recuperación y la pregunta", () => {
    const five = view.windows.at(-1)!;
    expect(five.worst).toMatch(
      /^Peor momento: \w+ de \d{4}, lo comprado valía -\d+,\d\d ?% respecto de lo aportado\. /,
    );
    expect(five.question).toBe(true);
    expect(five.priceDrawdown).toMatch(
      /^Mayor caída del precio: -\d+,\d\d ?%, de /,
    );
  });

  it("si nunca estuvo abajo, lo dice y no pregunta", () => {
    const up = buildBeforeBuyView(
      input({ candidateCloses: series(FIVE_YEARS_AGO, END, steady) }),
    )!;
    const five = up.windows.at(-1)!;
    expect(five.worst).toBe("Nunca estuvo por debajo de lo aportado.");
    expect(five.question).toBe(false);
    expect(five.priceDrawdown).toBeNull();
  });

  it("el gráfico va por dólar al mes, con pocos puntos, el último día y el peor momento", () => {
    const five = view.windows.at(-1)!;
    expect(five.chart.length).toBeLessThanOrEqual(MAX_CHART_POINTS);
    expect(five.chart.at(-1)!.date).toBe(END);
    expect(five.chart[0]!.invested).toBe(1);
    // El peor momento no se pierde al afinar: la peor razón dibujada es la del texto.
    const worstDrawn = Math.min(
      ...five.chart.map((p) => p.value / p.invested - 1),
    );
    const worstText = /valía (-\d+,\d\d)%/.exec(five.worst)![1]!;
    expect((worstDrawn * 100).toFixed(2).replace(".", ",")).toBe(worstText);
    expect(five.chart.every((p) => p.benchmark !== null)).toBe(true);
    const year = view.windows[0]!;
    expect(year.chart.length).toBeLessThanOrEqual(MAX_CHART_POINTS);
  });

  it("una salida a bolsa reciente: 1 año y «Todo»", () => {
    const ipo = buildBeforeBuyView(
      input({ candidateCloses: series("2025-05-01", END, wave) }),
    )!;
    expect(ipo.windows.map((w) => w.id)).toEqual(["1A", "ALL"]);
    expect(ipo.defaultWindowId).toBe("ALL");
    expect(plain(ipo.windows[1]!.plans["1000"]!.heading)).toMatch(
      /desde mayo de 2025/,
    );
  });

  it("con 3 años y pico de historia: 1 y 3 años, sin «Todo» (agregaría menos de 3 meses)", () => {
    const three = buildBeforeBuyView(
      input({ candidateCloses: series("2023-09-01", END, wave) }),
    )!;
    expect(three.windows.map((w) => w.id)).toEqual(["1A", "3A"]);
  });

  it("una caída chica se cuenta, pero no merece la pregunta", () => {
    const calm = buildBeforeBuyView(
      input({
        candidateCloses: series(
          FIVE_YEARS_AGO,
          END,
          (i) => 100 * (1 + 0.03 * Math.sin(i / 20)) + i * 0.05,
        ),
      }),
    )!;
    const five = calm.windows.at(-1)!;
    expect(five.worst).toMatch(/^Peor momento: /);
    expect(five.question).toBe(false);
  });

  it("con meses de historia, solo «Todo»; con días, nada que simular", () => {
    const months = buildBeforeBuyView(
      input({ candidateCloses: series("2026-05-04", END, wave) }),
    )!;
    expect(months.windows.map((w) => w.id)).toEqual(["ALL"]);
    const days = buildBeforeBuyView(
      input({ candidateCloses: series("2026-09-14", END, wave) }),
    )!;
    expect(days.windows).toEqual([]);
    expect(days.defaultWindowId).toBeNull();
  });

  it("sin ningún cierre del candidato no hay tarjeta", () => {
    expect(buildBeforeBuyView(input({ candidateCloses: [] }))).toBeNull();
  });
});
