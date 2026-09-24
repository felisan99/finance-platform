import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/portfolio/tone";

const CLASS: Record<Tone, string> = {
  gain: "text-gain",
  loss: "text-loss",
  flat: "text-muted-foreground",
};
const ARROW: Record<Tone, string> = { gain: "▲", loss: "▼", flat: "" };

/**
 * Un texto de ganancia o pérdida ya formateado, con su color y su flecha. Es presentacional y no
 * importa nada pesado a propósito: lo usan también los componentes de cliente (que reciben el
 * texto y el tono ya calculados en el servidor). `tone: null` es "sin dato".
 */
export function PnlText({
  text,
  tone,
  className,
}: {
  text: string;
  tone: Tone | null;
  className?: string;
}) {
  if (tone === null) {
    return (
      <span className={cn("text-muted-foreground", className)}>{text}</span>
    );
  }
  return (
    <span className={cn("tabular-nums", CLASS[tone], className)}>
      {ARROW[tone] && (
        <span aria-hidden="true" className="mr-0.5 text-[0.7em]">
          {ARROW[tone]}
        </span>
      )}
      {text}
    </span>
  );
}
