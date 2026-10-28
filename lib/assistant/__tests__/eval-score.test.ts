import { describe, expect, it } from "vitest";
import {
  containsAnchor,
  inventedNumbers,
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
  it("toma montos y porcentajes, no fechas, años ni números chicos", () => {
    expect(
      significantNumbers(
        "Al 30/09/2026 (2026-09-30, año 2025) tenés US$ 1.234,56, +12,40 % y 25 acciones de 1A",
      ),
    ).toEqual(["1.234,56", "12,40"]);
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
