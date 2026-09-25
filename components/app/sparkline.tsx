import { sparklineGeometry } from "@/lib/portfolio/sparkline";
import { cn } from "@/lib/utils";

const WIDTH = 96;
const HEIGHT = 32;

/**
 * Minigráfico de cierres, dibujado en el servidor (SVG sin librerías). Tiene tamaño fijo, así que
 * no se deforma. Es decorativo: el precio y el cambio del día ya están en texto al lado. Color
 * neutro a propósito: verde o rojo acá podría contradecir el cambio del día que se ve al lado.
 */
export function Sparkline({
  values,
  className,
}: {
  values: readonly number[];
  className?: string;
}) {
  const geometry = sparklineGeometry(values, WIDTH, HEIGHT);
  if (!geometry) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex h-8 w-24 shrink-0 items-center justify-center text-xs text-muted-foreground",
          className,
        )}
      >
        Sin historial
      </span>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <path
        d={geometry.line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={geometry.end.x}
        cy={geometry.end.y}
        r={2}
        fill="currentColor"
      />
    </svg>
  );
}
