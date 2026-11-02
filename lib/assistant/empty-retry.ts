import type { LanguageModelMiddleware } from "ai";

// Algunos modelos terminan un paso sin texto y sin tools (respuesta en blanco). Se reintenta el
// paso una vez; si sigue vacío, la persona recibe un mensaje de error en vez de una burbuja vacía.

export const EMPTY_RESPONSE_MESSAGE =
  "No pude armar una respuesta. Probá de nuevo en un momento.";

type Doing = NonNullable<LanguageModelMiddleware["wrapStream"]>;
type StreamResult = Awaited<ReturnType<Parameters<Doing>[0]["doStream"]>>;
type Part = StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const isVisible = (part: Part): boolean =>
  (part.type === "text-delta" && part.delta.length > 0) ||
  part.type === "tool-call" ||
  part.type === "tool-input-start";

export const emptyRetryMiddleware: LanguageModelMiddleware = {
  wrapStream: async ({ doStream }) => {
    const first = await doStream();
    let visible = false;
    let retried = false;

    const stream = new ReadableStream<Part>({
      async start(controller) {
        let reader = first.stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (isVisible(value)) visible = true;
            if (value.type === "finish" && !visible) {
              if (!retried) {
                // Se descarta el cierre del intento vacío y se pide otro.
                retried = true;
                reader = (await doStream()).stream.getReader();
                continue;
              }
              controller.enqueue({ type: "text-start", id: "empty-fallback" });
              controller.enqueue({
                type: "text-delta",
                id: "empty-fallback",
                delta: EMPTY_RESPONSE_MESSAGE,
              });
              controller.enqueue({ type: "text-end", id: "empty-fallback" });
            }
            // El segundo intento repite el arranque del stream: no se reenvía.
            if (retried && value.type === "stream-start") continue;
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return { ...first, stream };
  },
};
