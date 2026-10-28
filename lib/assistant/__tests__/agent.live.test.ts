import { describe, expect, it } from "vitest";
import { runAssistant } from "../agent";
import { getAssistantConfig } from "../config";
import { demoDataSource } from "../fixture/demo-data-source";
import { DEMO_TODAY } from "../fixture/demo-portfolio";
import { createTavilySearch } from "../news/tavily";
import { buildSystemPrompt } from "../prompt";
import { createAssistantModel } from "../provider";
import { summarizeRun } from "../telemetry";
import { buildTools, type ToolTiming } from "../tools";
import { getPositions } from "../tools/positions";

// En vivo: el modelo de OpenRouter de `.env.local` contra la cartera demo (y Tavily real). Manual:
// `pnpm test:live`. Gasta requests del límite diario de los modelos gratuitos.

const config = getAssistantConfig();

async function ask(question: string, withNews = false) {
  if (!config) throw new Error("falta la configuración del asistente");
  const ds = demoDataSource();
  const timings: ToolTiming[] = [];
  const tools = buildTools({
    ds,
    memory: null,
    news:
      withNews && config.tavilyKey
        ? {
            search: createTavilySearch(config.tavilyKey),
            takeLimit: async () => true,
            holds: async () => true,
          }
        : null,
    timings,
  });
  const started = performance.now();
  const result = runAssistant({
    model: createAssistantModel(config),
    instructions: buildSystemPrompt({
      todayText: "miércoles, 30 de setiembre de 2026",
      todayKey: DEMO_TODAY,
      scopeName: ds.scopeName,
      memories: [],
      summary: null,
      hasNews: withNews,
      hasMemory: false,
    }),
    messages: [{ role: "user", content: question }],
    tools,
  });
  const text = await result.text;
  const steps = await result.steps;
  const run = summarizeRun({
    event: null,
    requestedModel: config.model,
    timings,
    latencyMs: performance.now() - started,
    errorCode: null,
  });
  console.info(
    JSON.stringify(
      {
        question,
        model: (await result.response).modelId,
        steps: steps.length,
        tools: timings,
        latencyMs: run.latencyMs,
        usage: await result.totalUsage,
      },
      null,
      2,
    ),
  );
  console.info(text);
  return { text, timings, ds };
}

describe.skipIf(!config)("asistente en vivo (OpenRouter)", () => {
  it("responde el valor total usando get_positions y repite el número de la tool", async () => {
    const { text, timings, ds } = await ask(
      "¿Cuánto vale hoy mi cartera y cuánto tengo en efectivo?",
    );
    expect(timings.map((t) => t.name)).toContain("get_positions");
    const positions = await getPositions(ds);
    if (!positions.ok) throw new Error(positions.error);
    const data = positions.data as Record<string, string>;
    // `Intl` separa "US$" con un espacio no separable; el modelo suele devolver uno común.
    const plain = (value: string) => value.replace(/\s/g, " ");
    expect(plain(text)).toContain(plain(data.valor_total!));
  });

  it.skipIf(!config?.tavilyKey)("busca noticias con Tavily", async () => {
    const { timings } = await ask("¿Hay noticias recientes de NVDA?", true);
    expect(timings.map((t) => t.name)).toContain("search_news");
  });
});
