import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  ANNOUNCE_BUSY,
  ANNOUNCE_DONE,
  activityOf,
  announcementOf,
  ASSISTANT_GENERIC_ERROR,
  canRetry,
  sourcesOf,
} from "../chat-status";

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
  const partial = assistant([{ type: "text", text: "Tu cartera" }]);

  it("sin respuesta todavía: con cualquier error (el reintento no duplica la pregunta)", () => {
    expect(canRetry([user], rejected)).toBe(true);
    expect(canRetry([user], ASSISTANT_GENERIC_ERROR)).toBe(true);
    expect(canRetry([user], "Failed to fetch")).toBe(true);
    expect(canRetry([user], "Load failed")).toBe(true);
  });
  it("no sin error", () => {
    expect(canRetry([user], undefined)).toBe(false);
    expect(canRetry([user], "")).toBe(false);
  });
  it("con una respuesta a medias, si la ruta avisó la falla (no guardó la respuesta)", () => {
    expect(canRetry([user, partial], ASSISTANT_GENERIC_ERROR)).toBe(true);
    expect(canRetry([user, assistant([])], ASSISTANT_GENERIC_ERROR)).toBe(true);
    expect(
      canRetry(
        [user, assistant([{ type: "step-start" }])],
        ASSISTANT_GENERIC_ERROR,
      ),
    ).toBe(true);
  });
  it("no con una respuesta a medias si se cortó la conexión (el servidor la guarda completa)", () => {
    expect(canRetry([user, partial], "Failed to fetch")).toBe(false);
    expect(canRetry([user, partial], "network error")).toBe(false);
    expect(canRetry([user, partial], rejected)).toBe(false);
  });
  it("no sin mensajes ni con una respuesta que no sigue a una pregunta", () => {
    expect(canRetry([], rejected)).toBe(false);
    expect(canRetry([], ASSISTANT_GENERIC_ERROR)).toBe(false);
    expect(canRetry([partial], ASSISTANT_GENERIC_ERROR)).toBe(false);
  });
});

describe("announcementOf", () => {
  it("anuncia al empezar y al terminar", () => {
    expect(announcementOf(false, true, false)).toBe(ANNOUNCE_BUSY);
    expect(announcementOf(true, false, false)).toBe(ANNOUNCE_DONE);
  });

  it("si terminó en error no anuncia 'lista' ni repite el error: limpia la región", () => {
    expect(announcementOf(true, false, true)).toBe("");
  });

  it("sin transición (tokens llegando o en reposo) no anuncia nada", () => {
    expect(announcementOf(true, true, false)).toBeNull();
    expect(announcementOf(false, false, true)).toBeNull();
    expect(announcementOf(false, false, false)).toBeNull();
  });
});
