import { isRetryable } from "./errors";

export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Reintentos después del primer intento (3 → hasta 4 intentos en total). */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: Sleep;
  /** Devuelve un número en [0, 1); inyectable para que los tests sean deterministas. */
  random?: () => number;
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Reintenta con backoff exponencial y jitter ("equal jitter": entre la mitad y el total de la
 * espera calculada). Solo reintenta lo que `isRetryable` marca como transitorio; el resto se
 * propaga de inmediato.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    sleep = realSleep,
    random = Math.random,
    isRetryable: shouldRetry = isRetryable,
  } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(cap / 2 + (cap / 2) * random());
    }
  }
}

export interface LimiterOptions {
  /** Cuántas tareas a la vez como máximo. */
  concurrency: number;
  /** Separación mínima entre el inicio de una tarea y el de la siguiente. */
  minGapMs: number;
  sleep?: Sleep;
  now?: () => number;
}

/**
 * Limita la concurrencia y espacia los inicios: Yahoo no publica cuotas, así que se lo trata
 * con cuidado (best-effort).
 */
export function createLimiter(options: LimiterOptions) {
  const { concurrency, minGapMs, sleep = realSleep, now = Date.now } = options;
  let active = 0;
  let lastStart = Number.NEGATIVE_INFINITY;
  const waiting: Array<() => void> = [];

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    while (active >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      // Reservar el turno antes de dormir: las tareas que llegan juntas se escalonan.
      const startAt = Math.max(now(), lastStart + minGapMs);
      lastStart = startAt;
      const delay = startAt - now();
      if (delay > 0) await sleep(delay);
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
