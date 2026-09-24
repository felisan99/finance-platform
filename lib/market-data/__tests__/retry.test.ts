import { describe, expect, it, vi } from "vitest";
import { MarketDataError } from "../errors";
import { createLimiter, withRetry } from "../retry";

const transient = () => new MarketDataError("UNAVAILABLE", "caído");
const permanent = () => new MarketDataError("NOT_FOUND", "no existe");

describe("withRetry", () => {
  it("devuelve el resultado sin esperar si el primer intento anda", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => 42);
    expect(await withRetry(fn, { sleep })).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reintenta los errores transitorios y termina bien", async () => {
    let n = 0;
    const fn = async () => {
      if (++n < 3) throw transient();
      return "ok";
    };
    expect(
      await withRetry(fn, { sleep: async () => {}, random: () => 0 }),
    ).toBe("ok");
    expect(n).toBe(3);
  });

  it("no reintenta los errores permanentes", async () => {
    const fn = vi.fn(async () => {
      throw permanent();
    });
    await expect(
      withRetry(fn, { sleep: async () => {} }),
    ).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("no reintenta errores que no son de MarketDataError", async () => {
    const fn = vi.fn(async () => {
      throw new Error("bug");
    });
    await expect(withRetry(fn, { sleep: async () => {} })).rejects.toThrow(
      "bug",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("se rinde después de `retries` reintentos y propaga el último error", async () => {
    const fn = vi.fn(async () => {
      throw transient();
    });
    await expect(
      withRetry(fn, { retries: 2, sleep: async () => {} }),
    ).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("con retries = 0 hace un solo intento", async () => {
    const fn = vi.fn(async () => {
      throw transient();
    });
    await expect(
      withRetry(fn, { retries: 0, sleep: async () => {} }),
    ).rejects.toBeInstanceOf(MarketDataError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("el backoff es exponencial, con jitter entre la mitad y el total, y tiene tope", async () => {
    const waits = async (random: number) => {
      const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
      const fn = async () => {
        throw transient();
      };
      await withRetry(fn, {
        retries: 5,
        baseDelayMs: 500,
        maxDelayMs: 4_000,
        sleep,
        random: () => random,
      }).catch(() => {});
      return sleep.mock.calls.map(([ms]) => ms);
    };
    // random = 0 → mitad de la espera calculada; el tope de 4000 corta el crecimiento.
    expect(await waits(0)).toEqual([250, 500, 1000, 2000, 2000]);
    // random ≈ 1 → casi la espera completa.
    const high = await waits(0.999999);
    expect(high[0]).toBeCloseTo(500, 0);
    expect(high[4]).toBeCloseTo(4000, 0);
  });

  it("un isRetryable propio reemplaza al de MarketDataError", async () => {
    let n = 0;
    const fn = async () => {
      if (++n < 2) throw new Error("raro");
      return "ok";
    };
    const result = await withRetry(fn, {
      sleep: async () => {},
      isRetryable: (e) => e instanceof Error && e.message === "raro",
    });
    expect(result).toBe("ok");
  });
});

describe("createLimiter", () => {
  it("separa el inicio de cada tarea por al menos minGapMs", async () => {
    // Timers falsos: los `sleep` concurrentes esperan en paralelo, como con el reloj real.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const limit = createLimiter({ concurrency: 3, minGapMs: 100 });
      const starts: number[] = [];
      const all = Promise.all(
        Array.from({ length: 5 }, () =>
          limit(async () => {
            starts.push(Date.now());
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(1_000);
      await all;
      expect(starts).toEqual([0, 100, 200, 300, 400]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no supera la concurrencia máxima", async () => {
    const limit = createLimiter({
      concurrency: 2,
      minGapMs: 0,
      sleep: async () => {},
    });
    let active = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const task = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => gates.push(resolve));
        active--;
      });

    const all = Promise.all([task(), task(), task(), task(), task()]);
    // Dejar que arranquen las que entran: solo 2 a la vez.
    await new Promise((r) => setTimeout(r, 0));
    expect(active).toBe(2);
    while (gates.length > 0 || active > 0) {
      gates.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await all;
    expect(peak).toBe(2);
  });

  it("libera el lugar aunque la tarea falle", async () => {
    const limit = createLimiter({
      concurrency: 1,
      minGapMs: 0,
      sleep: async () => {},
    });
    await expect(
      limit(async () => {
        throw new Error("falló");
      }),
    ).rejects.toThrow("falló");
    await expect(limit(async () => "sigue")).resolves.toBe("sigue");
  });

  it("devuelve el resultado de cada tarea", async () => {
    const limit = createLimiter({
      concurrency: 2,
      minGapMs: 0,
      sleep: async () => {},
    });
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => limit(async () => n * 10)),
    );
    expect(results).toEqual([10, 20, 30, 40]);
  });
});
