import { describe, expect, it } from "vitest";
import { CASES } from "../evals/cases";
import { RequestPacer } from "../evals/runner";
import { scoreCase } from "../evals/score";
import { demoDataSource } from "../fixture/demo-data-source";
import { demoNews, inMemoryStore } from "../fixture/demo-deps";

// Los evals sin modelo: cada pregunta calcula su respuesta esperada con el motor, y una respuesta
// "perfecta" (las tools esperadas y los números exactos) aprueba. Si esto falla, el problema está
// en los casos o en la puntuación, no en el modelo.

describe("casos de los evals", () => {
  it("los ids son únicos y hay unas 40 preguntas", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  for (const evalCase of CASES) {
    it(`${evalCase.id}: la respuesta esperada se calcula y una respuesta perfecta aprueba`, async () => {
      const expectation = await evalCase.expect(demoDataSource());
      if (expectation.kind === "numeric") {
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
