import type { PriceRange } from "@/lib/portfolio/watchlist";
import { formatPrice } from "@/lib/portfolio/format";
import { cn } from "@/lib/utils";

/**
 * Rango de cierres de las últimas 52 semanas como una barra con el precio marcado: la punta
 * izquierda es el mínimo y la derecha el máximo. Sin rango (poco historial o rango plano) no se
 * dibuja nada.
 */
export function RangeBar({
  range,
  className,
}: {
  range: PriceRange | null;
  className?: string;
}) {
  if (!range) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        Sin rango de 52 semanas
      </p>
    );
  }
  const low = formatPrice(range.low);
  const high = formatPrice(range.high);
  const percent = Math.round(Math.min(1, Math.max(0, range.position)) * 100);

  return (
    <div
      role="img"
      aria-label={`Rango de 52 semanas: mínimo ${low}, máximo ${high}; el precio está al ${percent} % del rango`}
      className={cn("min-w-0", className)}
    >
      <div className="relative h-1 rounded-full bg-muted-foreground/25">
        <span
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-[0.65rem] text-muted-foreground tabular-nums">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}
