"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  parseMarkdown,
  type Block,
  type Inline,
} from "@/lib/assistant/markdown";
import { TOOL_LABELS, sourceOf } from "@/lib/assistant/tool-result";
import { cn } from "@/lib/utils";

const MAX_QUESTION = 2000;

const SUGGESTIONS = [
  "¿Cuánto vale hoy mi cartera?",
  "¿Cómo rindió en el último año contra el S&P 500?",
  "¿Qué posiciones movieron la cartera el mes pasado?",
  "¿Qué tan concentrada está mi cartera?",
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

function MarkdownText({ text }: { text: string }) {
  const blocks: Block[] = parseMarkdown(text);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <p key={i} className="font-semibold">
                {renderInline(block.inlines)}
              </p>
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

/** Los chips de fuente salen de las tools que de verdad corrieron, no de lo que diga el modelo. */
function ToolChips({ message }: { message: UIMessage }) {
  const chips = message.parts.flatMap((part, i) => {
    if (!part.type.startsWith("tool-")) return [];
    const name = part.type.slice(5);
    const label = TOOL_LABELS[name] ?? name;
    const state = (part as { state?: string }).state;
    if (state === "output-available") {
      const source = sourceOf((part as { output?: unknown }).output);
      return [
        {
          key: i,
          text: source ? `${label} · ${source.fn} · ${source.detail}` : label,
          pending: false,
        },
      ];
    }
    if (state === "output-error") return [];
    return [{ key: i, text: `${label}…`, pending: true }];
  });
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Fuentes">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {chip.pending && (
            <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
          )}
          {chip.text}
        </li>
      ))}
    </ul>
  );
}

function MessageView({ message }: { message: UIMessage }) {
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
  return (
    <div className="mr-4 flex flex-col gap-2 self-start">
      <ToolChips message={message} />
      {text && <MarkdownText text={text} />}
    </div>
  );
}

export function AssistantChat({
  conversationId,
  initialMessages,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
}) {
  const [input, setInput] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, status]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    void sendMessage({ text: question.slice(0, MAX_QUESTION) });
    setInput("");
  };

  const failure = errorText(error);

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Preguntame sobre tu cartera. Cada número sale de los cálculos de la
            app y te digo de dónde viene.
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
            <MessageView key={message.id} message={message} />
          ))}
          {status === "submitted" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              Pensando…
            </p>
          )}
        </div>
      )}

      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}

      <form
        className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="assistant-question" className="sr-only">
          Tu pregunta
        </label>
        <textarea
          id="assistant-question"
          value={input}
          maxLength={MAX_QUESTION}
          rows={1}
          placeholder="Preguntá algo sobre tu cartera"
          className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-muted-foreground md:text-sm"
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
      <div ref={bottom} />
    </div>
  );
}
