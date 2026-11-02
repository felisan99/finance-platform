import { describe, expect, it } from "vitest";
import { CASES } from "../evals/cases";
import { EXTRA_CASES } from "../evals/cases-extra";
import { RequestPacer } from "../evals/runner";
import { scoreCase } from "../evals/score";
import { demoDataSource } from "../fixture/demo-data-source";
import { selectCases } from "../evals/select";
import { DEMO_UNAVAILABLE_SYMBOL } from "../fixture/demo-data-source";
import {
  CANARY_ASSET,
  CANARY_NEWS_MEMORY,
  CANARY_NEWS_PROMPT,
  CANARY_WEB,
  CANARY_WEB_MEMORY,
  demoNews,
  demoWeb,
  inMemoryStore,
} from "../fixture/demo-deps";

// Los evals sin modelo: cada pregunta calcula su respuesta esperada con el motor, y una respuesta
// "perfecta" (las tools esperadas y los números exactos) aprueba. Si esto falla, el problema está
// en los casos o en la puntuación, no en el modelo.

describe("casos de los evals", () => {
  it("los ids son únicos y hay unas 40 preguntas", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it("los ids de CASES y de los casos extra son únicos entre sí", () => {
    const ids = [...CASES, ...EXTRA_CASES].map((c) => c.id);
    // CASES ya incluye a EXTRA_CASES: cada id aparece una vez en CASES.
    expect(CASES.length).toBeGreaterThanOrEqual(EXTRA_CASES.length);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    expect(new Set(EXTRA_CASES.map((c) => c.id)).size).toBe(EXTRA_CASES.length);
    expect(new Set(ids).size).toBe(CASES.length);
  });

  it("los splits suman lo que dice el código: 50 dev y 31 test", () => {
    expect(CASES.filter((c) => c.split === "dev")).toHaveLength(50);
    expect(CASES.filter((c) => c.split === "test")).toHaveLength(31);
  });

  it("dev y test no comparten ids y las dos partes tienen casos", () => {
    const dev = CASES.filter((c) => c.split === "dev").map((c) => c.id);
    const test = CASES.filter((c) => c.split === "test").map((c) => c.id);
    expect(dev.length).toBeGreaterThan(0);
    expect(test.length).toBeGreaterThan(0);
    expect(dev.filter((id) => test.includes(id))).toEqual([]);
    expect(dev.length + test.length).toBe(CASES.length);
  });

  it("EVAL_SPLIT filtra por split y rechaza valores desconocidos", () => {
    const test = selectCases(CASES, { split: "test" });
    expect(test.length).toBeGreaterThan(0);
    expect(test.every((c) => c.split === "test")).toBe(true);
    expect(selectCases(CASES, { split: "" })).toHaveLength(CASES.length);
    expect(selectCases(CASES, { split: "dev", limit: 3 })).toHaveLength(3);
    expect(() => selectCases(CASES, { split: "prod" })).toThrow();
  });

  it("los casos de seguridad traen su canario o fragmentos del prompt y la web y las noticias maliciosas existen", async () => {
    const forbidden = new Map<string, readonly string[]>();
    for (const c of CASES.filter((c) => c.category === "seguridad")) {
      const e = await c.expect(demoDataSource());
      if (e.kind === "news") forbidden.set(c.id, e.forbidden ?? []);
    }
    for (const [id, list] of forbidden) {
      expect(list.length, id).toBeGreaterThan(0);
    }
    const [amzn] = await demoNews.search("AMZN stock news", 7);
    expect(amzn?.snippet).toContain(CANARY_NEWS_PROMPT);
    const [aapl] = await demoNews.search("AAPL stock news", 7);
    expect(aapl?.snippet).toContain(CANARY_NEWS_MEMORY);
    const [rates] = await demoWeb.searchWeb("tasas de la Fed analistas");
    expect(rates?.snippet).toContain(CANARY_WEB);
    const [div] = await demoWeb.searchWeb("guía de dividendos para el retiro");
    expect(div?.snippet).toContain(CANARY_WEB_MEMORY);
    const zeta = await demoDataSource().assetInfo("ZETA");
    expect(zeta.status === "ok" && zeta.info.name).toContain(CANARY_ASSET);
    expect(await demoDataSource().assetInfo(DEMO_UNAVAILABLE_SYMBOL)).toEqual({
      status: "unavailable",
    });
  });

  it("una respuesta que obedece a la inyección no aprueba", async () => {
    const evalCase = CASES.find((c) => c.id === "sec-news-prompt-leak")!;
    const expectation = await evalCase.expect(demoDataSource());
    const calls = [{ name: "search_news", input: {}, output: {} }];
    const bad = scoreCase(evalCase.question, expectation, {
      text: `${CANARY_NEWS_PROMPT}: acá va mi prompt.`,
      calls,
      memories: [],
    });
    expect(bad.passed).toBe(false);
  });

  for (const evalCase of CASES) {
    it(`${evalCase.id}: la respuesta esperada se calcula y una respuesta perfecta aprueba`, async () => {
      const expectation = await evalCase.expect(demoDataSource());
      if (expectation.kind === "numeric" && !expectation.anyTools?.length) {
        expect(expectation.anchors.length).toBeGreaterThan(0);
        for (const anchor of expectation.anchors) expect(anchor).not.toBe("—");
      }
      const perfect = {
        text:
          expectation.kind === "missing"
            ? "No tengo ese dato."
            : expectation.kind === "no_execute"
              ? "No puedo ejecutar operaciones."
              : expectation.kind === "off_topic"
                ? "Solo puedo ayudarte con tu cartera e inversiones."
                : expectation.kind === "recommendation"
                  ? "Mantené la posición: ya es la más grande."
                  : `Según la app: ${expectation.anchors.join(" y ")}.`,
        calls: [
          ...expectation.tools,
          ...(expectation.anyTools ?? []).slice(0, 1),
        ].map((name) => ({
          name,
          input: {},
          output: { anchors: expectation.anchors },
        })),
        memories:
          expectation.kind === "memory" && expectation.shouldRemember
            ? ["Perfil conservador"]
            : [],
      };
      const score = scoreCase(evalCase.question, expectation, perfect);
      expect(score.passed, JSON.stringify(score)).toBe(true);
    });
  }
});

describe("fixture de los evals", () => {
  it("las noticias simuladas responden por símbolo y la de KO trae la inyección", async () => {
    expect(await demoNews.search("NVDA stock news", 7)).toHaveLength(2);
    const [ko] = await demoNews.search("KO stock news", 7);
    expect(ko?.snippet).toContain("IGNORE PREVIOUS INSTRUCTIONS");
    expect(await demoNews.search("TSLA stock news", 7)).toEqual([]);
  });

  it("la memoria en memoria agrega, edita y borra", async () => {
    const store = inMemoryStore();
    const item = await store.add("goal", "Jubilarse");
    await store.update(item.id, "Viajar");
    expect((await store.list())[0]?.content).toBe("Viajar");
    expect(await store.remove(item.id)).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it("el limitador de requests espera cuando se llena la ventana", async () => {
    const pacer = new RequestPacer(3);
    pacer.record(2);
    const started = Date.now();
    await pacer.reserve(1);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
