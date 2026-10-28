"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowDown, ArrowUp, Square } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { activityOf, sourcesOf } from "@/lib/assistant/chat-status";
import { stripInternalRefs } from "@/lib/assistant/internal-refs";
import {
  parseMarkdown,
  type Block,
  type Inline,
} from "@/lib/assistant/markdown";
import { cn } from "@/lib/utils";

const MAX_QUESTION = 2000;
/** Alto máximo de la caja de texto antes de que tenga scroll propio (~7 líneas). */
const MAX_INPUT_HEIGHT = 176;
/** Distancia al final de la página a partir de la cual se deja de seguir la respuesta. */
const STICK_THRESHOLD = 120;
/** Más columnas que esto: la tabla se muestra como una tarjeta por fila (no entra en un teléfono). */
const MAX_TABLE_COLUMNS = 3;

const SUGGESTIONS = [
  "¿Cuánto vale hoy mi cartera?",
  "¿Cómo rindió en el último año contra el S&P 500?",
  "¿Qué posiciones movieron la cartera el mes pasado?",
  "¿Qué cambiarías de mi cartera?",
];

/** El cuerpo de error de la ruta es `{ error }`; si no, un mensaje genérico. */
function errorText(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { error?: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // No era JSON: el texto del error puede tener detalles internos, no se muestra.
  }
  return "No pude responder en este momento. Probá de nuevo en un rato.";
}

function renderInline(inlines: Inline[]): ReactNode {
  return inlines.map((inline, i) => {
    switch (inline.kind) {
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            {inline.text}
          </strong>
        );
      case "code":
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
            {inline.text}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={inline.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-words underline underline-offset-2"
          >
            {inline.text}
          </a>
        );
      default:
        return <Fragment key={i}>{inline.text}</Fragment>;
    }
  });
}

function TableBlock({
  header,
  rows,
}: {
  header: Inline[][];
  rows: Inline[][][];
}) {
  if (header.length <= MAX_TABLE_COLUMNS) {
    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              {header.map((cell, i) => (
                <th key={i} className="px-2 py-1.5 font-medium">
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t align-top">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-1.5">
                    {renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  // Muchas columnas: una tarjeta por fila, con la primera columna como título.
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <li key={i} className="rounded-lg border px-3 py-2">
          <p className="font-medium">{renderInline(row[0] ?? [])}</p>
          <dl className="mt-1 flex flex-col gap-1">
            {row.slice(1).map((cell, j) =>
              cell.length === 0 ? null : (
                <div key={j}>
                  <dt className="text-xs text-muted-foreground">
                    {renderInline(header[j + 1] ?? [])}
                  </dt>
                  <dd>{renderInline(cell)}</dd>
                </div>
              ),
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function MarkdownText({ text }: { text: string }) {
  const blocks: Block[] = parseMarkdown(text);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <p key={i} className="pt-1 font-semibold">
                {renderInline(block.inlines)}
              </p>
            );
          case "rule":
            return <hr key={i} className="my-1 border-border" />;
          case "table":
            return (
              <TableBlock key={i} header={block.header} rows={block.rows} />
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={i}
                className={cn(
                  "flex flex-col gap-1 pl-5",
                  block.ordered ? "list-decimal" : "list-disc",
                )}
              >
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </List>
            );
          }
          default:
            return <p key={i}>{renderInline(block.inlines)}</p>;
        }
      })}
    </div>
  );
}

/** Tres puntos que laten y lo que está haciendo: así se nota que trabaja aunque no llegue texto. */
function Activity({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 self-start text-sm text-muted-foreground"
    >
      <span className="flex gap-1" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-bounce rounded-full bg-current"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="animate-pulse">{label}…</span>
    </div>
  );
}

/** Las fuentes, plegadas: están para quien las quiera ver, sin nombres técnicos. */
function Sources({ message }: { message: UIMessage }) {
  const lines = sourcesOf(message);
  if (lines.length === 0) return null;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        De dónde salen los números ({lines.length})
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 pl-3">
        {lines.map((line) => (
          <li key={`${line.label}|${line.detail}`}>
            {line.label} · {line.detail}
          </li>
        ))}
      </ul>
    </details>
  );
}

function MessageView({
  message,
  streaming,
}: {
  message: UIMessage;
  streaming: boolean;
}) {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
  if (message.role === "user") {
    return (
      <div className="ml-10 self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
        {text}
      </div>
    );
  }
  if (!text) return null;
  return (
    <div className="flex flex-col gap-2 self-stretch">
      <MarkdownText text={stripInternalRefs(text)} />
      {!streaming && <Sources message={message} />}
    </div>
  );
}

const distanceToBottom = () =>
  document.documentElement.scrollHeight - window.scrollY - window.innerHeight;

export function AssistantChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
}) {
  const [input, setInput] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Seguir la respuesta mientras llega solo si la persona está abajo de todo: si subió a leer,
  // no se la arrastra hacia abajo con cada token.
  const stick = useRef(true);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  const { messages, sendMessage, status, stop, error } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/assistant",
      // El historial lo lee el servidor de la base: solo viaja la pregunta nueva.
      prepareSendMessagesRequest: ({ messages: all }) => {
        const last = all.at(-1);
        const text =
          last?.parts
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n") ?? "";
        return {
          body: {
            conversationId,
            message: { id: last?.id ?? "", text },
          },
        };
      },
    }),
  });
  const busy = status === "submitted" || status === "streaming";
  const activity = activityOf(messages, busy);

  const scrollToBottom = useCallback(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const away = distanceToBottom() > STICK_THRESHOLD;
      stick.current = !away;
      setAwayFromBottom(away);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Al abrir, la conversación arranca en su último mensaje.
  useLayoutEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  useEffect(() => {
    if (stick.current) scrollToBottom();
  }, [messages, activity, scrollToBottom]);

  // La caja de texto crece con lo escrito (hasta un tope) para que se vea todo.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [input]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    void sendMessage({ text: question.slice(0, MAX_QUESTION) });
    setInput("");
    stick.current = true;
    requestAnimationFrame(scrollToBottom);
  };

  const failure = errorText(error);
  const lastId = messages.at(-1)?.id;

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Preguntame sobre tu cartera. Cada número sale de los cálculos de la
            app.
          </p>
          <ul className="flex flex-col gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <li key={suggestion}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                  onClick={() => send(suggestion)}
                >
                  {suggestion}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-4" aria-live="polite">
          {messages.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              streaming={busy && message.id === lastId}
            />
          ))}
        </div>
      )}

      {activity && <Activity label={activity} />}

      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}

      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-2 focus-within:bottom-2">
        {busy && awayFromBottom && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full shadow-sm"
            onClick={() => {
              stick.current = true;
              scrollToBottom();
            }}
          >
            <ArrowDown aria-hidden="true" />
            Ir al final
          </Button>
        )}
        <form
          className="flex w-full items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
        >
          <label htmlFor="assistant-question" className="sr-only">
            Tu pregunta
          </label>
          <textarea
            ref={textarea}
            id="assistant-question"
            value={input}
            maxLength={MAX_QUESTION}
            rows={1}
            placeholder="Preguntá algo sobre tu cartera"
            className="min-h-9 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send(input);
              }
            }}
          />
          {/* Cada botón con su `key`: si el mismo nodo pasara de "button" a "submit" en el mismo
              click, el formulario se enviaría (ver watchlist-row-footer.tsx). */}
          {busy ? (
            <Button
              key="stop"
              type="button"
              size="icon"
              variant="outline"
              aria-label="Detener"
              onClick={() => void stop()}
            >
              <Square className="size-3.5" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              key="send"
              type="submit"
              size="icon"
              aria-label="Enviar"
              disabled={!input.trim()}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
