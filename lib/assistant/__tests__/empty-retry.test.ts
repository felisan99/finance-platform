import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { runAssistant } from "../agent";
import { EMPTY_RESPONSE_MESSAGE } from "../empty-retry";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finish = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage,
} as const;
const empty = [{ type: "stream-start", warnings: [] }, finish] as const;
const withText = (text: string) =>
  [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    finish,
  ] as const;

function modelOf(responses: readonly (readonly unknown[])[]) {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const chunks = responses[Math.min(calls++, responses.length - 1)]!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partes de stream del mock
      return { stream: simulateReadableStream({ chunks: chunks as any }) };
    },
  });
  return { model, calls: () => calls };
}

const run = (model: MockLanguageModelV4) =>
  runAssistant({
    model,
    instructions: "x",
    messages: [{ role: "user", content: "hola" }],
    tools: {},
  });

describe("respuesta en blanco", () => {
  it("reintenta una vez y usa la segunda respuesta", async () => {
    const { model, calls } = modelOf([empty, withText("Hola")]);
    expect(await run(model).text).toBe("Hola");
    expect(calls()).toBe(2);
  });

  it("si sigue vacía, devuelve un error genérico y no reintenta más", async () => {
    const { model, calls } = modelOf([empty]);
    expect(await run(model).text).toBe(EMPTY_RESPONSE_MESSAGE);
    expect(calls()).toBe(2);
  });

  it("una respuesta normal no se reintenta", async () => {
    const { model, calls } = modelOf([withText("Listo")]);
    expect(await run(model).text).toBe("Listo");
    expect(calls()).toBe(1);
  });
});
