import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/database.types";
import { getCloseSeries } from "../queries";

// `getCloseSeries` con un cliente de mentira: cuántas llamadas hace y cómo arma el mapa (el RPC de
// verdad se prueba en rpc.integration.test.ts).

type Args = { p_instrument_ids: string[]; p_from: string; p_adjusted: boolean };

function clientReturning(
  respond: (args: Args) => { data: unknown; error: { message: string } | null },
) {
  const rpc = vi.fn((name: string, args: Args) => {
    expect(name).toBe("price_series");
    return Promise.resolve(respond(args));
  });
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

describe("getCloseSeries", () => {
  it("una llamada para hasta 50 instrumentos, sin repetidos, y los que no vuelven quedan vacíos", async () => {
    const { client, rpc } = clientReturning(() => ({
      data: [
        {
          instrument_id: "a",
          dates: ["2026-09-24", "2026-09-25"],
          closes: ["10.5", "11"],
        },
        // Uno que no se pidió no se cuela.
        { instrument_id: "x", dates: ["2026-09-25"], closes: ["1"] },
      ],
      error: null,
    }));
    const result = await getCloseSeries(
      client,
      ["a", "b", "a"],
      "2026-01-01",
      "adj_close",
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("price_series", {
      p_instrument_ids: ["a", "b"],
      p_from: "2026-01-01",
      p_adjusted: true,
    });
    expect(result).toEqual(
      new Map([
        [
          "a",
          [
            { date: "2026-09-24", value: "10.5" },
            { date: "2026-09-25", value: "11" },
          ],
        ],
        ["b", []],
      ]),
    );
  });

  it("parte la lista de a 50 y pide `close` sin ajustar", async () => {
    const { client, rpc } = clientReturning(() => ({ data: [], error: null }));
    const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);
    const result = await getCloseSeries(client, ids, "2026-01-01", "close");
    expect(
      rpc.mock.calls.map(([, args]) => args.p_instrument_ids.length),
    ).toEqual([50, 50, 20]);
    expect(rpc.mock.calls.every(([, args]) => !args.p_adjusted)).toBe(true);
    expect(result.size).toBe(120);
  });

  it("sin instrumentos no llama a la base", async () => {
    const { client, rpc } = clientReturning(() => {
      throw new Error("no debería llamar");
    });
    expect(await getCloseSeries(client, [], "2026-01-01", "close")).toEqual(
      new Map(),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un error de la base o una fila con arreglos de distinto largo es un error", async () => {
    await expect(
      getCloseSeries(
        clientReturning(() => ({ data: null, error: { message: "caída" } }))
          .client,
        ["a"],
        "2026-01-01",
        "close",
      ),
    ).rejects.toThrow("db price_series: caída");
    await expect(
      getCloseSeries(
        clientReturning(() => ({
          data: [{ instrument_id: "a", dates: ["2026-09-25"], closes: [] }],
          error: null,
        })).client,
        ["a"],
        "2026-01-01",
        "close",
      ),
    ).rejects.toThrow("formato inesperado");
    await expect(
      getCloseSeries(
        clientReturning(() => ({
          data: [{ instrument_id: "a", dates: ["25/09/2026"], closes: ["1"] }],
          error: null,
        })).client,
        ["a"],
        "2026-01-01",
        "close",
      ),
    ).rejects.toThrow("formato inesperado");
  });
});
