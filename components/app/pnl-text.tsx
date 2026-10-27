import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/portfolio/tone";

const CLASS: Record<Tone, string> = {
  gain: "text-gain",
  loss: "text-loss",
  flat: "text-muted-foreground",
};
const ARROW: Record<Tone, string> = { gain: "▲", loss: "▼", flat: "" };
// Pastilla: el mismo color de texto sobre un fondo teñido de ese color. El texto de `--gain` y
// `--loss` ya está pensado para leerse sobre la tarjeta en claro y en oscuro; el tinte es leve.
const PILL = "inline-block rounded-full px-1.5 py-0.5 leading-none";
const PILL_BG: Record<Tone, string> = {
  gain: "bg-gain/15",
  loss: "bg-loss/15",
  flat: "bg-muted",
};

/**
 * Un texto de ganancia o pérdida ya formateado, con su color y su flecha. Es presentacional y no
 * importa nada pesado a propósito: lo usan también los componentes de cliente (que reciben el
 * texto y el tono ya calculados en el servidor). `tone: null` es "sin dato".
 */
export function PnlText({
  text,
  tone,
  pill = false,
  className,
}: {
  text: string;
  tone: Tone | null;
  /** Con fondo teñido (la ganancia % de la lista de posiciones). */
  pill?: boolean;
  className?: string;
}) {
  if (tone === null) {
    return (
      <span
        className={cn(
          "text-muted-foreground",
          pill && `${PILL} bg-muted`,
          className,
        )}
      >
        {text}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        CLASS[tone],
        pill && `${PILL} ${PILL_BG[tone]}`,
        className,
      )}
    >
      {ARROW[tone] && (
        <span aria-hidden="true" className="mr-0.5 text-[0.7em]">
          {ARROW[tone]}
        </span>
      )}
      {text}
    </span>
  );
}
