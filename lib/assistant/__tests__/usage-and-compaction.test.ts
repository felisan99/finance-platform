import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  COMPACT_AFTER_MESSAGES,
  KEEP_RECENT,
  planCompaction,
  transcriptOf,
  type StoredMessage,
} from "../compaction";
import { getAssistantConfig } from "../config";
import { looksLikePortfolioNumber } from "../memory";
import { buildSystemPrompt } from "../prompt";
import { summarizeRun } from "../telemetry";
import { buildUsageView, percentile, type RunRow } from "../usage-view";

const message = (
  seq: number,
  role: "user" | "assistant",
  text = "hola",
): StoredMessage => ({
  seq,
  message: {
    id: `m${seq}`,
    role,
    parts: [{ type: "text", text }],
  } as UIMessage,
});

/** Pregunta y respuesta alternadas, empezando por la persona. */
const dialog = (count: number): StoredMessage[] =>
  Array.from({ length: count }, (_, i) =>
    message(i + 1, i % 2 === 0 ? "user" : "assistant"),
  );

describe("planCompaction", () => {
  it("no compacta una conversación corta", () => {
    expect(planCompaction(dialog(COMPACT_AFTER_MESSAGES), null)).toEqual({
      compact: false,
    });
  });

  it("al pasar el umbral resume todo menos los últimos, cortando antes de una pregunta", () => {
    const messages = dialog(COMPACT_AFTER_MESSAGES + 1);
    const plan = planCompaction(messages, null);
    if (!plan.compact) throw new Error("se esperaba compactar");
    const kept = messages.filter((m) => m.seq > plan.through);
    expect(kept.length).toBeLessThanOrEqual(KEEP_RECENT);
    expect(kept[0]!.message.role).toBe("user");
    expect(plan.fold.at(-1)!.seq).toBe(plan.through);
  });

  it("también compacta por tokens aunque haya pocos mensajes", () => {
    const long = "x".repeat(60_000);
    const messages = [
      message(1, "user", long),
      message(2, "assistant", long),
      ...dialog(KEEP_RECENT).map((m) => ({ ...m, seq: m.seq + 2 })),
    ];
    const plan = planCompaction(messages, null);
    expect(plan.compact).toBe(true);
  });

  it("si lo que queda no empezaría con una pregunta, no corta", () => {
    const onlyAnswers = Array.from({ length: 20 }, (_, i) =>
      message(i + 1, i === 0 ? "user" : "assistant"),
    );
    expect(planCompaction(onlyAnswers, null)).toEqual({ compact: false });
  });

  it("el texto a resumir lleva lo dicho y las tools usadas, sin sus salidas", () => {
    const text = transcriptOf([
      {
        id: "a",
        role: "user",
        parts: [{ type: "text", text: "¿Cuánto vale?" }],
      },
      {
        id: "b",
        role: "assistant",
        parts: [
          {
            type: "tool-get_positions",
            toolCallId: "1",
            state: "output-available",
            input: {},
            output: { secreto: "US$ 1" },
          },
          { type: "text", text: "Vale mucho." },
        ],
      } as UIMessage,
    ]);
    expect(text).toBe(
      "Persona: ¿Cuánto vale?\nAsistente: [usó get_positions] Vale mucho.",
    );
    expect(text).not.toContain("US$");
  });
});

describe("looksLikePortfolioNumber", () => {
  it("detecta montos, porcentajes y cantidades, pero deja números chicos sueltos", () => {
    expect(looksLikePortfolioNumber("Tengo US$ 500")).toBe(true);
    expect(looksLikePortfolioNumber("500 dólares")).toBe(true);
    expect(looksLikePortfolioNumber("un 15%")).toBe(true);
    expect(looksLikePortfolioNumber("1.000 acciones")).toBe(true);
    expect(looksLikePortfolioNumber("precio 12,5")).toBe(true);
    expect(looksLikePortfolioNumber("Se jubila en 20 años")).toBe(false);
    expect(looksLikePortfolioNumber("No quiere cripto")).toBe(false);
  });
});

describe("getAssistantConfig", () => {
  const base = {
    OPENROUTER_API_KEY: "sk-or-v1-0123456789abcdef",
    ASSISTANT_MODEL: "nvidia/nemotron-3-ultra-550b-a55b:free",
  };

  it("falla cerrado sin clave o con un modelo inválido", () => {
    expect(getAssistantConfig({})).toBeNull();
    expect(getAssistantConfig({ ...base, OPENROUTER_API_KEY: " " })).toBeNull();
    expect(
      getAssistantConfig({ ...base, ASSISTANT_MODEL: "sin barra" }),
    ).toBeNull();
  });

  it("el respaldo y Tavily son opcionales; un respaldo igual al principal se ignora", () => {
    expect(getAssistantConfig(base)).toEqual({
      apiKey: base.OPENROUTER_API_KEY,
      model: base.ASSISTANT_MODEL,
      fallbackModel: null,
      tavilyKey: null,
    });
    expect(
      getAssistantConfig({
        ...base,
        ASSISTANT_FALLBACK_MODEL: base.ASSISTANT_MODEL,
      })?.fallbackModel,
    ).toBeNull();
    expect(
      getAssistantConfig({
        ...base,
        ASSISTANT_FALLBACK_MODEL: "google/gemma-4-31b-it:free",
        TAVILY_API_KEY: "tvly-0123456789",
      }),
    ).toMatchObject({
      fallbackModel: "google/gemma-4-31b-it:free",
      tavilyKey: "tvly-0123456789",
    });
  });
});

describe("buildSystemPrompt", () => {
  const input = {
    todayText: "miércoles, 30 de setiembre de 2026",
    todayKey: "2026-09-30",
    scopeName: "Portafolio demo",
    memories: [],
    summary: null,
    hasNews: false,
    hasMemory: false,
  };

  it("recomienda, pero no inventa ni calcula datos ni opera", () => {
    const prompt = buildSystemPrompt(input);
    expect(prompt).toContain("## Recomendaciones");
    expect(prompt).toContain("no tengo ese dato");
    expect(prompt).toContain("No los calcules vos");
    expect(prompt).toContain("no podés operar");
    expect(prompt).toContain("tu primera frase dice que no podés operar");
    expect(prompt).toContain("No uses aproximaciones");
    expect(prompt).toContain("simulate_trade");
    expect(prompt).toContain("## Alcance");
    expect(prompt).toContain('portafolio "Portafolio demo"');
    expect(prompt).not.toContain("search_news");
    expect(prompt).not.toContain("## Memoria");
    expect(prompt).not.toContain("## Resumen");
    expect(prompt).not.toContain("{{");
  });

  it("el ejemplo de cita usa el último año hasta hoy y el formato de la app", () => {
    const prompt = buildSystemPrompt(input);
    // `formatPercent` escribe el % pegado al número.
    expect(prompt).not.toMatch(/\d %/);
    expect(prompt).toContain("(computeTwr, 1A: 30/09/2025 – 30/09/2026)");
  });

  it("agrega noticias, memoria y resumen solo si corresponden", () => {
    const prompt = buildSystemPrompt({
      ...input,
      hasNews: true,
      hasMemory: true,
      memories: [
        { id: "id-1", kind: "goal", content: "Jubilarse", updatedAt: "" },
      ],
      summary: "- Preguntó por su rendimiento",
    });
    expect(prompt).toContain("contenido de terceros");
    expect(prompt).toContain("[id-1] Objetivo: Jubilarse");
    expect(prompt).toContain("Preguntó por su rendimiento");
  });
});

describe("summarizeRun", () => {
  it("sin evento (error antes de responder) registra el error y la latencia", () => {
    const run = summarizeRun({
      event: null,
      requestedModel: "a/b:free",
      timings: [{ name: "get_positions", ok: true, ms: 3 }],
      latencyMs: 1234.4,
      errorCode: "http_429",
    });
    expect(run).toMatchObject({
      model: "a/b:free",
      fallbackUsed: false,
      steps: 0,
      latencyMs: 1234,
      errorCode: "http_429",
      costUsd: null,
    });
  });
});

describe("buildUsageView", () => {
  const row = (over: Partial<RunRow>): RunRow => ({
    created_at: "2026-09-30T00:00:00Z",
    model: "a/b:free",
    fallback_used: false,
    steps: 2,
    tools: [],
    input_tokens: 100,
    output_tokens: 20,
    ttft_ms: 500,
    latency_ms: 2000,
    error_code: null,
    compacted: false,
    context_tokens_before: null,
    context_tokens_after: null,
    ...over,
  });

  it("percentiles por rango más cercano", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });

  it("cuenta turnos, errores, respaldo, tools y ahorro de la compactación", () => {
    const view = buildUsageView([
      row({ tools: [{ name: "get_positions", ok: true, ms: 5 }] }),
      row({
        fallback_used: true,
        model: "c/d:free",
        tools: [
          { name: "get_positions", ok: false, ms: 5 },
          { name: "get_risk", ok: true, ms: 9 },
        ],
      }),
      row({
        error_code: "http_429",
        compacted: true,
        context_tokens_before: 10_000,
        context_tokens_after: 2_500,
      }),
    ]);
    expect(view.turns).toBe(3);
    expect(view.errors).toBe(1);
    expect(view.fallbackShare).toBeCloseTo(1 / 3);
    expect(view.tools[0]).toEqual({
      name: "get_positions",
      label: "Posiciones",
      calls: 2,
      failures: 1,
    });
    expect(view.compactions).toBe(1);
    expect(view.compactionSaving).toBeCloseTo(0.75);
    expect(view.models).toEqual([
      { model: "a/b:free", turns: 2 },
      { model: "c/d:free", turns: 1 },
    ]);
  });

  it("sin datos no inventa promedios", () => {
    const view = buildUsageView([]);
    expect(view.fallbackShare).toBeNull();
    expect(view.latencyP50).toBeNull();
    expect(view.compactionSaving).toBeNull();
  });
});
