// Geometría de un minigráfico: convierte una serie de valores en el `d` de un `<path>` SVG. Es solo
// para dibujar (usa `number`): los montos que ve la persona salen de decimales.

export interface SparklineGeometry {
  /** Atributo `d` del trazo (línea). */
  line: string;
  /** Punto final, para marcar el último cierre. */
  end: { x: number; y: number };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Traza la serie en un rectángulo `width × height` con `pad` de margen (para que el trazo grueso no
 * se corte en los bordes). El eje Y se ajusta al mínimo y máximo de la serie. Una serie plana se
 * dibuja como una recta al medio. Devuelve `null` con menos de dos puntos o valores no finitos.
 */
export function sparklineGeometry(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): SparklineGeometry | null {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value)))
    return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;

  const points = values.map((value, index) => ({
    x: round(pad + (index / (values.length - 1)) * innerW),
    // Y crece hacia abajo en SVG: el valor más alto va arriba.
    y: round(
      span === 0 ? height / 2 : pad + (1 - (value - min) / span) * innerH,
    ),
  }));

  return {
    line: points
      .map((p, index) => `${index === 0 ? "M" : "L"}${p.x} ${p.y}`)
      .join(" "),
    end: points[points.length - 1]!,
  };
}
