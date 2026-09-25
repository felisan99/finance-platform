import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/database.types";
import { computeEngine, d, valuePortfolio, type PriceInfo } from "@/lib/engine";
import { buy, deposit } from "@/lib/engine/__tests__/helpers";
import { loadPerformanceOutcome } from "../performance-data";
import type { PortfolioSnapshot } from "../snapshot";
import { loadPositionTrends } from "../trend-data";
import { TREND_POINTS, TREND_ROWS } from "../trend-view";

// La lectura de Inicio que no es cálculo: el resultado compartido del rendimiento y el RPC de las
// tendencias, con un cliente de mentira (la base de verdad se prueba en las suites de integración
// y en vivo).

type Client = SupabaseClient<Database>;
const T = "2026-01-05T15:00:00Z";
const NOW = new Date("2026-09-24T18:00:00Z");

const price = (value: string): PriceInfo => ({
  price: d(value),
  asOf: new Date("2026-09-23T20:00:00Z"),
  source: "quote",
  previousClose: d(value),
});

function snapshotOf(symbols: string[], withTransactions = true) {
  const txs = withTransactions
    ? [deposit(T, "100000"), ...symbols.map((s) => buy(T, s, "1", "10"))]
    : [];
  const valued = valuePortfolio(
    computeEngine(txs),
    // Más caro el que viene antes en la lista: el orden por valor es el del arreglo.
    new Map(symbols.map((s, i) => [s, price(String(100 - i))] as const)),
  );
  return {
    account: { id: "acc", currency: "USD" },
    transactions: txs,
    valued,
    instrumentById: new Map(),
    instrumentBySymbol: new Map(
      symbols.map((s) => [s, { id: `id-${s}`, symbol: s, name: `${s} Inc` }]),
    ),
  } as unknown as PortfolioSnapshot;
}

afterEach(() => vi.restoreAllMocks());

describe("loadPerformanceOutcome", () => {
  it("sin operaciones es 'empty' y no toca la base", async () => {
    const client = {
      from: () => {
        throw new Error("no debería leer");
      },
    } as unknown as Client;
    await expect(
      loadPerformanceOutcome(client, snapshotOf([], false)),
    ).resolves.toEqual({ status: "empty" });
  });

  it("si la base falla, la promesa NO se rechaza: es 'error' y queda registrado", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      from: () => {
        throw new Error("la base se cayó");
      },
    } as unknown as Client;
    const outcome = await loadPerformanceOutcome(client, snapshotOf(["AAA"]));
    expect(outcome).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith("[performance]", expect.any(String));
  });
});

describe("loadPositionTrends", () => {
  it("sin posiciones abiertas con precio no toca la base", async () => {
    const client = {
      rpc: () => {
        throw new Error("no debería leer");
      },
    } as unknown as Client;
    await expect(
      loadPositionTrends(client, snapshotOf([], false), NOW),
    ).resolves.toEqual([]);
  });

  it(`pide las ${TREND_ROWS} más grandes con ${TREND_POINTS} cierres en UNA llamada y arma las filas`, async () => {
    const symbols = ["A", "B", "C", "D", "E", "F", "G"];
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          instrument_id: "id-A",
          last_close: "100",
          last_date: "2026-09-23",
          prev_close: "99",
          prev_date: "2026-09-22",
          low_close: "90",
          high_close: "101",
          recent: [
            ["2026-09-21", "98"],
            ["2026-09-22", "99"],
            ["2026-09-23", "100"],
          ],
        },
      ],
      error: null,
    });
    const rows = await loadPositionTrends(
      { rpc } as unknown as Client,
      snapshotOf(symbols),
      NOW,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("watchlist_market", {
      p_instrument_ids: ["id-A", "id-B", "id-C", "id-D", "id-E"],
      // 60 días antes de "hoy": la ventana del RPC (devuelve las últimas 22 ruedas de todos modos).
      p_since: "2026-07-26",
      p_points: TREND_POINTS,
    });
    expect(rows.map((r) => r.symbol)).toEqual(["A", "B", "C", "D", "E"]);
    // A tiene minigráfico; B no tiene fila de mercado: queda vacío y se muestra igual.
    expect(rows[0]!.spark).toEqual([98, 99, 100]);
    expect(rows[1]!.spark).toEqual([]);
    expect(rows[0]!.name).toBe("A Inc");
  });

  it("si el RPC falla, lanza (la sección de Inicio lo atrapa y no muestra nada)", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(
      loadPositionTrends({ rpc } as unknown as Client, snapshotOf(["A"]), NOW),
    ).rejects.toThrow(/watchlist_market/);
  });
});
