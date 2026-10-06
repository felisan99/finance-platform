import { afterEach, describe, expect, it, vi } from "vitest";
import { QUOTE_MAX_AGE_MS, staleQuoteIds, withTimeout } from "../freshness";

const NOW = new Date("2026-10-06T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("staleQuoteIds", () => {
  it("pide las de 2 horas o más y las que no tienen cotización; no repite", () => {
    const fetchedAt = new Map<string, Date | null>([
      ["fresca", ago(QUOTE_MAX_AGE_MS - 1)],
      ["justo", ago(QUOTE_MAX_AGE_MS)],
      ["vieja", ago(5 * QUOTE_MAX_AGE_MS)],
      ["nunca", null],
    ]);
    expect(
      staleQuoteIds(
        ["fresca", "justo", "vieja", "nunca", "sin-fila", "vieja"],
        fetchedAt,
        NOW,
      ),
    ).toEqual(["justo", "vieja", "nunca", "sin-fila"]);
  });

  it("sin instrumentos no hay nada que pedir", () => {
    expect(staleQuoteIds([], new Map(), NOW)).toEqual([]);
  });

  it("una fecha del futuro (reloj adelantado) cuenta como fresca", () => {
    expect(staleQuoteIds(["a"], new Map([["a", ago(-60_000)]]), NOW)).toEqual(
      [],
    );
  });
});

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("devuelve el resultado si llega a tiempo", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it("devuelve null si se pasa del tiempo", async () => {
    vi.useFakeTimers();
    const slow = new Promise<number>((resolve) =>
      setTimeout(() => resolve(1), 10_000),
    );
    const result = withTimeout(slow, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toBeNull();
  });

  it("un error que llega a tiempo se propaga; uno que llega tarde no queda suelto", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("yahoo")), 1000),
    ).rejects.toThrow("yahoo");

    vi.useFakeTimers();
    const late = new Promise<number>((_, reject) =>
      setTimeout(() => reject(new Error("tarde")), 10_000),
    );
    const result = withTimeout(late, 5000);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
  });
});
