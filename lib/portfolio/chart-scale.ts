// Escala de un eje vertical con marcas "redondas" (2.000, 4.000… o 98, 100, 102…) en vez de las que
// elige el gráfico por su cuenta (11250, 7713…). Sin imports: la usa también un componente de cliente.

const NICE_STEPS = [1, 2, 2.5, 5, 10];

export interface Scale {
  /** Límites del eje: contienen a todos los datos. */
  domain: [number, number];
  ticks: number[];
  /** Decimales que hacen falta para que las marcas no se repitan al redondear. */
  decimals: number;
}

/** Paso "redondo" (1, 2, 2,5, 5 × 10^k) que da a lo sumo `targetTicks` intervalos. */
function niceStep(range: number, targetTicks: number): number {
  const raw = range / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  const factor =
    NICE_STEPS.find((candidate) => candidate >= normalized - 1e-9) ?? 10;
  return factor * magnitude;
}

/**
 * Escala para datos entre `min` y `max`. Con datos constantes abre un margen para que la línea no
 * quede pegada al borde.
 */
export function niceScale(min: number, max: number, targetTicks = 4): Scale {
  let low = min;
  let high = max;
  // Un rango minúsculo respecto de la magnitud (1e-9 sobre 100) es "dato constante": con los pasos
  // que saldrían, las marcas se repetirían al redondear.
  const magnitude = Math.max(Math.abs(low), Math.abs(high));
  if (high - low <= Math.max(1e-9, magnitude * 1e-6)) {
    const margin = magnitude * 0.01 || 1;
    low -= margin;
    high += margin;
  }
  const step = niceStep(high - low, targetTicks);
  const first = Math.floor(low / step + 1e-9);
  const last = Math.ceil(high / step - 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= last; k++) {
    ticks.push(Number((k * step).toPrecision(12)));
  }
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return {
    domain: [ticks[0] as number, ticks[ticks.length - 1] as number],
    ticks,
    decimals,
  };
}
