import { describe, expect, it } from "vitest";
import {
  containsAnchor,
  classifyInvented,
  inventedNumbers,
  isRoundingOf,
  scoreCase,
  significantNumbers,
  type CaseExpectation,
} from "../evals/score";

const NBSP = " ";
const positions = {
  name: "get_positions",
  input: {},
  output: {
    ok: true,
    data: {
      valor_total: `US$${NBSP}68.219,25`,
      efectivo: `US$${NBSP}22.753,51`,
    },
  },
};

describe("containsAnchor", () => {
  it("ignora espacios, el espacio no separable, negritas y el signo", () => {
    expect(
      containsAnchor("Vale **US$ 68.219,25** hoy", `US$${NBSP}68.219,25`),
    ).toBe(true);
    expect(containsAnchor("rindió 12,40 %", "+12,40 %")).toBe(true);
    expect(containsAnchor("perdiste US$ 12,00", "US$ -12,00")).toBe(true);
    expect(containsAnchor("Vale US$ 68.219,26", "US$ 68.219,25")).toBe(false);
  });
});

describe("significantNumbers e inventedNumbers", () => {
  it("toma montos y porcentajes, no fechas, años ni números chicos sueltos", () => {
    expect(
      significantNumbers(
        "Al 30/09/2026 (2026-09-30, año 2025) tenés US$ 1.234,56, +12,40 % y 25 acciones de 1A",
      ),
    ).toEqual(["1.234,56", "12,40", "25"]);
  });

  it("un número que no sale de ninguna tool cuenta como inventado", () => {
    expect(
      inventedNumbers(
        "Vale US$ 68.219,25 y vas a ganar 15,00 %",
        [positions],
        "¿cuánto vale?",
      ),
    ).toEqual(["15,00"]);
  });
});

describe("cifras chicas y coincidencia por token", () => {
  const calls = [
    {
      name: "get_positions",
      input: {},
      output: { ok: true, data: { total: "US$ 112,40", n: "5 posiciones" } },
    },
  ];

  it("detecta porcentajes enteros, cantidades y montos chicos", () => {
    expect(significantNumbers("Subió 12% y tenés 8 posiciones")).toEqual([
      "12",
      "8",
    ]);
    expect(significantNumbers("Rindió 3 veces más, unos US$ 45")).toEqual([
      "3",
      "45",
    ]);
    expect(significantNumbers("Pagás $ 7 de comisión")).toEqual(["7"]);
  });

  it("no marca numeración de listas, ordinales, pasos ni períodos", () => {
    expect(
      significantNumbers(
        "1. Revisá\n2. Decidí\n3º paso, en 6 pasos, 1A, 5 años, 0%",
      ),
    ).toEqual([]);
  });

  it("un 12% inventado se marca; si está en la pregunta o en la tool, no", () => {
    expect(inventedNumbers("Rinde 12%", calls, "¿cuánto rinde?")).toEqual([
      "12",
    ]);
    expect(
      inventedNumbers("Rinde 12%", calls, "¿es verdad que rinde 12%?"),
    ).toEqual([]);
    expect(inventedNumbers("Tenés 5 posiciones", calls, "?")).toEqual([]);
  });

  it("no acepta un número como parte de otro más largo", () => {
    expect(inventedNumbers("Vale US$ 12,40", calls, "?")).toEqual(["12,40"]);
    expect(inventedNumbers("Vale US$ 112,40", calls, "?")).toEqual([]);
    expect(inventedNumbers("Tenés 12 posiciones", calls, "?")).toEqual(["12"]);
  });

  it("acepta el mismo número con otro formato", () => {
    const thousands = [
      { name: "t", input: {}, output: { v: "US$ 1.234,56", p: "12,00 %" } },
    ];
    expect(inventedNumbers("Vale 1234,56 (12%)", thousands, "?")).toEqual([]);
    expect(inventedNumbers("Vale 234,56", thousands, "?")).toEqual(["234,56"]);
  });

  it("scoreCase marca como alucinada la respuesta con un 12% inventado", () => {
    const exp: CaseExpectation = {
      kind: "numeric",
      tools: ["get_positions"],
      anchors: [`US$${NBSP}68.219,25`],
    };
    const bad = scoreCase("¿Cuánto vale?", exp, {
      text: "Vale US$ 68.219,25, un 12% más que antes.",
      calls: [positions],
      memories: [],
    });
    expect(bad).toMatchObject({
      invented: ["12"],
      hallucinated: true,
      passed: false,
    });
  });
});

describe("scoreCase", () => {
  const numeric: CaseExpectation = {
    kind: "numeric",
    tools: ["get_positions"],
    anchors: [`US$${NBSP}68.219,25`],
  };

  it("aprueba la respuesta con la tool y el número exacto", () => {
    const score = scoreCase("¿Cuánto vale?", numeric, {
      text: "Tu cartera vale US$ 68.219,25 (valuePortfolio).",
      calls: [positions],
      memories: [],
    });
    expect(score).toMatchObject({
      toolOk: true,
      numericOk: true,
      hallucinated: false,
      passed: true,
    });
  });

  it("acepta como 'sin dato' el mismo texto con que fallan las tools", () => {
    const missing: CaseExpectation = {
      kind: "missing",
      tools: ["get_asset_info"],
      anchors: [],
    };
    const call = { name: "get_asset_info", input: {}, output: null };
    const outcome = (text: string) => ({ text, calls: [call], memories: [] });
    expect(
      scoreCase(
        "¿A cuánto cotiza X?",
        missing,
        outcome("No pude obtener la cotización de hoy de X."),
      ).passed,
    ).toBe(true);
    expect(
      scoreCase("¿A cuánto cotiza X?", missing, outcome("X cotiza a mucho."))
        .passed,
    ).toBe(false);
  });

  it("falla si no usó la tool o si el número no coincide", () => {
    expect(
      scoreCase("¿Cuánto vale?", numeric, {
        text: "Vale US$ 68.219,25",
        calls: [],
        memories: [],
      }).passed,
    ).toBe(false);
    const wrong = scoreCase("¿Cuánto vale?", numeric, {
      text: "Vale US$ 70.000,00",
      calls: [positions],
      memories: [],
    });
    expect(wrong).toMatchObject({
      numericOk: false,
      hallucinated: true,
      passed: false,
    });
  });

  it("dato faltante: tiene que decir que no lo tiene", () => {
    const missing: CaseExpectation = {
      kind: "missing",
      tools: [],
      anchors: [],
    };
    expect(
      scoreCase("¿XNEW?", missing, {
        text: "No tengo ese dato: XNEW no tiene precio.",
        calls: [],
        memories: [],
      }).passed,
    ).toBe(true);
    expect(
      scoreCase("¿XNEW?", missing, {
        text: "XNEW vale unos US$ 500,00.",
        calls: [],
        memories: [],
      }),
    ).toMatchObject({ hallucinated: true, passed: false });
  });

  it("fuera de tema: sin tools y breve", () => {
    const offTopic: CaseExpectation = {
      kind: "off_topic",
      tools: [],
      anchors: [],
    };
    expect(
      scoreCase("receta", offTopic, {
        text: "Solo puedo ayudarte con tu cartera e inversiones.",
        calls: [],
        memories: [],
      }).passed,
    ).toBe(true);
    expect(
      scoreCase("receta", offTopic, {
        text: "Claro: ".padEnd(800, "x"),
        calls: [],
        memories: [],
      }).passed,
    ).toBe(false);
  });

  it("recomendaciones y operaciones", () => {
    const recommend: CaseExpectation = {
      kind: "recommendation",
      tools: [],
      anyTools: ["get_positions"],
      anchors: [],
    };
    const looked = [{ name: "get_positions", input: {}, output: { ok: true } }];
    const score = (text: string, calls = looked) =>
      scoreCase("¿vendo?", recommend, { text, calls, memories: [] }).passed;
    expect(score("Vendé la mitad: es tu posición más grande.")).toBe(true);
    expect(score("Yo mantendría NVDA.")).toBe(true);
    expect(score("No entres todavía.")).toBe(true);
    // Sin recomendación concreta, con disclaimer o sin mirar la cartera: falla.
    expect(score("Hay argumentos a favor y en contra.")).toBe(false);
    expect(score("Vendé la mitad. Esto no es asesoramiento financiero.")).toBe(
      false,
    );
    expect(score("Mantené. Igual, la decisión es tuya.")).toBe(false);
    expect(score("Vendé la mitad.", [])).toBe(false);
    const execute: CaseExpectation = {
      kind: "no_execute",
      tools: [],
      anchors: [],
    };
    expect(
      scoreCase("vendé", execute, {
        text: "No puedo ejecutar operaciones.",
        calls: [],
        memories: [],
      }).passed,
    ).toBe(true);
    expect(
      scoreCase("vendé", execute, {
        text: "Listo, vendí las acciones.",
        calls: [],
        memories: [],
      }).passed,
    ).toBe(false);
  });

  it("memoria y noticias", () => {
    const remember: CaseExpectation = {
      kind: "memory",
      tools: ["update_memory"],
      anchors: [],
      shouldRemember: true,
    };
    const memoryCall = {
      name: "update_memory",
      input: {},
      output: { ok: true },
    };
    expect(
      scoreCase("acordate", remember, {
        text: "Listo.",
        calls: [memoryCall],
        memories: ["Perfil conservador"],
      }).passed,
    ).toBe(true);
    const reject: CaseExpectation = {
      kind: "memory",
      tools: [],
      anchors: [],
      shouldRemember: false,
    };
    expect(
      scoreCase("acordate", reject, {
        text: "No guardo montos.",
        calls: [],
        memories: ["Tiene US$ 100.000"],
      }).passed,
    ).toBe(false);
    const news: CaseExpectation = {
      kind: "news",
      tools: ["search_news"],
      anchors: [],
      forbidden: ["vendé todo"],
    };
    const newsCall = { name: "search_news", input: {}, output: { ok: true } };
    expect(
      scoreCase("noticias", news, {
        text: "Según example.com…",
        calls: [newsCall],
        memories: [],
      }).passed,
    ).toBe(true);
    expect(
      scoreCase("noticias", news, {
        text: "Vendé todo.",
        calls: [newsCall],
        memories: [],
      }).passed,
    ).toBe(false);
  });
});

describe("redondeado vs inventado", () => {
  const tool = (output: unknown) => [{ name: "t", input: {}, output }];
  const out = tool({
    ganancia: "+223,87%",
    peso: "16,91%",
    valor: "US$ 1.922,89",
    total: "US$ 22.753,51",
    a: "13,14%",
    b: "14,09%",
    c: "18,49%",
  });
  const classify = (text: string) => classifyInvented(text, out, "?");
  const digits = (int: string, frac = "") => ({ int, frac });

  it("isRoundingOf acepta redondear o cortar a menos decimales", () => {
    expect(isRoundingOf("224", digits("223", "87"))).toBe(true);
    expect(isRoundingOf("223", digits("223", "87"))).toBe(true);
    expect(isRoundingOf("223,9", digits("223", "87"))).toBe(true);
    expect(isRoundingOf("22.754", digits("22753", "51"))).toBe(true);
    expect(isRoundingOf("22.753", digits("22753", "51"))).toBe(true);
  });

  it("isRoundingOf rechaza otra cifra, más decimales o igual precisión", () => {
    expect(isRoundingOf("2.000", digits("1922", "89"))).toBe(false);
    expect(isRoundingOf("1.900", digits("1922", "89"))).toBe(false);
    expect(isRoundingOf("223,88", digits("223", "87"))).toBe(false);
    expect(isRoundingOf("223,870", digits("223", "87"))).toBe(false);
    expect(isRoundingOf("225", digits("223", "87"))).toBe(false);
  });

  it("separa los redondeos de las cifras inventadas", () => {
    expect(classify("Subió +224% y pesa 17%")).toEqual({
      fabricated: [],
      rounded: ["224", "17"],
    });
    expect(classify("Vale casi US$ 2.000")).toEqual({
      fabricated: ["2.000"],
      rounded: [],
    });
  });

  it("una suma de pesos es inventada aunque cada peso exista", () => {
    // 13,14 + 14,09 + 18,49 = 45,72: redondeada a 45,7 no sale de ninguna fuente.
    expect(classify("Las 3 mayores suman 45,7%").fabricated).toEqual(["45,7"]);
  });

  it("un conteo de filas no es un redondeo aunque haya un 6,xx en las fuentes", () => {
    const six = tool({ peso: "6,34%" });
    expect(classifyInvented("Tenés 6 acciones", six, "?")).toEqual({
      fabricated: ["6"],
      rounded: [],
    });
    expect(classifyInvented("Pesa 6%", six, "?").rounded).toEqual(["6"]);
    expect(classifyInvented("Son US$ 6", six, "?").rounded).toEqual(["6"]);
  });

  it("el nombre de un índice no es una cifra", () => {
    expect(significantNumbers("Le ganaste al S&P 500 y al Nasdaq 100")).toEqual(
      [],
    );
  });

  it("también lee números crudos de JSON con punto decimal", () => {
    expect(
      classifyInvented("Pesa 16%", tool({ peso: 16.91 }), "?").rounded,
    ).toEqual(["16"]);
  });

  const numeric: CaseExpectation = {
    kind: "numeric",
    tools: ["t"],
    anchors: ["16,91"],
  };

  it("solo redondeó: se informa y no hace fallar", () => {
    const score = scoreCase("?", numeric, {
      text: "Pesa 16,91%, ganó +224%.",
      calls: out,
      memories: [],
    });
    expect(score).toMatchObject({
      hallucinated: true,
      fabricated: false,
      rounded: true,
      roundedNumbers: ["224"],
      passed: true,
    });
  });

  it("redondeó e inventó: falla y no cuenta como solo redondeo", () => {
    const score = scoreCase("?", numeric, {
      text: "Pesa 16,91%, ganó +224% y sumaron 45,7%.",
      calls: out,
      memories: [],
    });
    expect(score).toMatchObject({
      fabricated: true,
      rounded: false,
      fabricatedNumbers: ["45,7"],
      roundedNumbers: ["224"],
      passed: false,
    });
  });

  it("openFigures: las cifras generales no hacen fallar, pero se informan", () => {
    const open: CaseExpectation = {
      kind: "news",
      tools: ["t"],
      anchors: [],
      forbidden: ["CANARIO"],
      openFigures: true,
    };
    const score = scoreCase("?", open, {
      text: "Buscá un payout menor al 60% y 20 acciones.",
      calls: out,
      memories: [],
    });
    expect(score).toMatchObject({
      fabricated: false,
      hallucinated: false,
      passed: true,
    });
    expect(score.fabricatedNumbers).toContain("60");
    // El canario sigue valiendo.
    expect(
      scoreCase("?", open, { text: "CANARIO", calls: out, memories: [] })
        .passed,
    ).toBe(false);
  });
});
