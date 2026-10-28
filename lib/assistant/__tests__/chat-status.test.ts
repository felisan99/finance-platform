import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { activityOf, canRetry, sourcesOf } from "../chat-status";

const user: UIMessage = {
  id: "u",
  role: "user",
  parts: [{ type: "text", text: "¿Cuánto vale?" }],
};
const assistant = (parts: unknown[]): UIMessage =>
  ({ id: "a", role: "assistant", parts }) as UIMessage;

const tool = (state: string, output?: unknown) => ({
  type: "tool-get_positions",
  toolCallId: "1",
  state,
  input: {},
  ...(output === undefined ? {} : { output }),
});

describe("activityOf", () => {
  it("sin trabajo en curso no muestra nada", () => {
    expect(activityOf([user], false)).toBeNull();
  });

  it("recién enviada la pregunta, o con un paso vacío: pensando", () => {
    expect(activityOf([user], true)).toBe("Pensando");
    expect(activityOf([user, assistant([{ type: "step-start" }])], true)).toBe(
      "Pensando",
    );
  });

  it("mientras corre una tool, lo que está haciendo en palabras de la persona", () => {
    expect(
      activityOf(
        [user, assistant([{ type: "step-start" }, tool("input-available")])],
        true,
      ),
    ).toBe("Revisando tus posiciones");
  });

  it("después de la tool, mientras el modelo piensa: analizando", () => {
    const done = tool("output-available", {
      ok: true,
      source: { fn: "f", detail: "d" },
    });
    expect(activityOf([user, assistant([done])], true)).toBe(
      "Analizando los datos",
    );
    expect(
      activityOf([user, assistant([done, { type: "step-start" }])], true),
    ).toBe("Analizando los datos");
  });

  it("cuando ya llega texto, el texto es la señal: sin indicador", () => {
    expect(
      activityOf(
        [user, assistant([{ type: "text", text: "Tu cartera vale" }])],
        true,
      ),
    ).toBeNull();
    expect(
      activityOf([user, assistant([{ type: "text", text: "" }])], true),
    ).toBe("Pensando");
  });

  it("un texto y después otra tool: vuelve el indicador", () => {
    expect(
      activityOf(
        [
          user,
          assistant([{ type: "text", text: "Miro." }, tool("input-streaming")]),
        ],
        true,
      ),
    ).toBe("Revisando tus posiciones");
  });
});

describe("sourcesOf", () => {
  it("las tools que terminaron bien, sin repetir y sin nombres técnicos", () => {
    const ok = {
      ok: true,
      source: { fn: "valuePortfolio", detail: "precios al 30/09/2026" },
    };
    expect(
      sourcesOf(
        assistant([
          tool("output-available", ok),
          tool("output-available", ok),
          tool("output-available", { ok: false, error: "x" }),
          tool("input-available"),
        ]),
      ),
    ).toEqual([{ label: "Posiciones", detail: "precios al 30/09/2026" }]);
  });
});

describe("canRetry", () => {
  const rejected = JSON.stringify({
    error: "Hiciste muchas preguntas seguidas.",
  });
  const streamFailure =
    "No pude responder en este momento. Probá de nuevo en un rato.";

  it("permite reintentar si la ruta rechazó la pregunta y no hay respuesta", () => {
    expect(canRetry([user], rejected)).toBe(true);
  });
  it("no sin error", () => {
    expect(canRetry([user], undefined)).toBe(false);
    expect(canRetry([user], "")).toBe(false);
  });
  it("no si el error ocurrió durante la respuesta (la pregunta pudo guardarse)", () => {
    expect(canRetry([user], streamFailure)).toBe(false);
    expect(canRetry([user], "Failed to fetch")).toBe(false);
  });
  it("no si ya hay una respuesta parcial", () => {
    expect(
      canRetry([user, assistant([{ type: "text", text: "Hola" }])], rejected),
    ).toBe(false);
  });
  it("no sin mensajes ni con JSON sin `error` de texto", () => {
    expect(canRetry([], rejected)).toBe(false);
    expect(canRetry([user], JSON.stringify({ error: 5 }))).toBe(false);
    expect(canRetry([user], "null")).toBe(false);
  });
});
