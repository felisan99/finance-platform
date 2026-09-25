import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PG,
  createAdmin,
  createAnon,
  createTestUser,
  deleteTestUser,
  randomSymbol,
  type DbClient,
  type TestUser,
} from "@/lib/db/__tests__/integration-helpers";
import {
  getWatchlistId,
  getWatchlistItems,
  getWatchlistMarket,
} from "../queries";
import { WATCHLIST_MAX } from "../watchlist";
import { loadWatchlist } from "../watchlist-data";

// `watchlist_market` y el tope de 50 símbolos contra finance-dev (`pnpm test:integration`).
// Usuarios e instrumentos de prueba: se borran al terminar (primero los usuarios: sus filas de
// watchlist apuntan a los instrumentos).

function must<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
  what: string,
): NonNullable<R["data"]> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(
      `Preparación: ${what}: ${result.error?.message ?? "sin datos"}`,
    );
  }
  return result.data as NonNullable<R["data"]>;
}

describe("watchlist (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;
  let full: string[]; // ids de WATCHLIST_MAX + 1 instrumentos para el tope
  let priced: string; // con 6 cierres
  let single: string; // con un solo cierre
  let bare: string; // sin ningún cierre
  const created: string[] = [];

  /** Cierres de `priced` (fecha → cierre), guardados con la precisión de la columna. */
  const CLOSES: Array<[string, string]> = [
    ["2025-01-02", "50"],
    ["2025-06-02", "100"],
    ["2025-07-01", "80"],
    ["2025-08-01", "120"],
    ["2025-09-01", "110"],
    ["2025-09-02", "111.123456"],
  ];

  async function makeInstruments(count: number): Promise<string[]> {
    const rows = Array.from({ length: count }, () => ({
      symbol: randomSymbol(),
      name: "Instrumento de prueba",
      type: "STOCK",
    }));
    const inserted = must(
      await admin.from("instruments").insert(rows).select("id"),
      "instrumentos",
    );
    const ids = inserted.map((row) => row.id);
    created.push(...ids);
    return ids;
  }

  const follow = (user: TestUser, watchlistId: string, ids: string[]) =>
    user.client.from("watchlist_items").insert(
      ids.map((instrument_id) => ({
        watchlist_id: watchlistId,
        instrument_id,
        user_id: user.id,
      })),
    );

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "wl-a");
    b = await createTestUser(admin, "wl-b");

    full = await makeInstruments(WATCHLIST_MAX + 1);
    const [p, s1, n] = await makeInstruments(3);
    priced = p!;
    single = s1!;
    bare = n!;

    must(
      await admin
        .from("prices_daily")
        .insert(
          CLOSES.map(([date, close]) => ({
            instrument_id: priced,
            date,
            close: Number(close),
          })),
        )
        .select("date"),
      "cierres",
    );
    must(
      await admin
        .from("prices_daily")
        .insert({ instrument_id: single, date: "2025-09-02", close: 7.5 })
        .select("date"),
      "cierre suelto",
    );
  });

  afterAll(async () => {
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
    if (created.length > 0)
      await admin.from("instruments").delete().in("id", created);
  });

  describe("watchlist_market", () => {
    it("devuelve último y penúltimo cierre, rango de la ventana y los últimos cierres, en texto", async () => {
      const rows = await getWatchlistMarket(
        a.client,
        [priced],
        "2025-06-01",
        3,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        instrument_id: priced,
        last_close: "111.123456",
        last_date: "2025-09-02",
        prev_close: "110.000000",
        prev_date: "2025-09-01",
        // Desde 2025-06-01 quedan 100, 80, 120, 110 y 111,123456: el 50 de enero queda afuera.
        low_close: "80.000000",
        high_close: "120.000000",
        recent: [
          ["2025-08-01", "120.000000"],
          ["2025-09-01", "110.000000"],
          ["2025-09-02", "111.123456"],
        ],
      });
    });

    it("la ventana decide el rango, no el último y penúltimo cierre ni los puntos", async () => {
      const wide = await getWatchlistMarket(
        a.client,
        [priced],
        "2025-01-01",
        2,
      );
      expect(wide[0]).toMatchObject({
        low_close: "50.000000",
        high_close: "120.000000",
        last_close: "111.123456",
        prev_close: "110.000000",
        recent: [
          ["2025-09-01", "110.000000"],
          ["2025-09-02", "111.123456"],
        ],
      });
      // Ventana posterior a todos los cierres: no hay rango, pero sí último cierre y puntos.
      const stale = await getWatchlistMarket(
        a.client,
        [priced],
        "2026-01-01",
        2,
      );
      expect(stale[0]).toMatchObject({
        last_close: "111.123456",
        low_close: null,
        high_close: null,
      });
      expect(stale[0]?.recent).toHaveLength(2);
    });

    it("un solo cierre: sin penúltimo; sin ningún cierre: no devuelve fila", async () => {
      const rows = await getWatchlistMarket(
        a.client,
        [single, bare],
        "2025-01-01",
        10,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        instrument_id: single,
        last_close: "7.500000",
        prev_close: null,
        prev_date: null,
        low_close: "7.500000",
        high_close: "7.500000",
        recent: [["2025-09-02", "7.500000"]],
      });
    });

    it("varios instrumentos a la vez, una fila por cada uno", async () => {
      const rows = await getWatchlistMarket(
        a.client,
        [priced, single, bare],
        "2025-01-01",
        5,
      );
      expect(rows.map((r) => r.instrument_id).sort()).toEqual(
        [priced, single].sort(),
      );
    });

    it("una lista vacía no devuelve nada; más de 100 ids o parámetros inválidos, error", async () => {
      expect(await getWatchlistMarket(a.client, [], "2025-01-01", 5)).toEqual(
        [],
      );

      const many = Array.from({ length: 101 }, () => randomUUID());
      const tooMany = await a.client.rpc("watchlist_market", {
        p_instrument_ids: many,
        p_since: "2025-01-01",
        p_points: 5,
      });
      expect(tooMany.error?.code).toBe("22023");

      for (const points of [1, 401, 0, -3]) {
        const bad = await a.client.rpc("watchlist_market", {
          p_instrument_ids: [priced],
          p_since: "2025-01-01",
          p_points: points,
        });
        expect(bad.error?.code, `p_points=${points}`).toBe("22023");
      }
      const noSince = await a.client.rpc("watchlist_market", {
        p_instrument_ids: [priced],
        p_since: null as unknown as string,
        p_points: 5,
      });
      expect(noSince.error?.code).toBe("22023");
    });

    it("sin sesión (rol anon) no se puede ejecutar", async () => {
      const { error } = await createAnon().rpc("watchlist_market", {
        p_instrument_ids: [priced],
        p_since: "2025-01-01",
        p_points: 5,
      });
      expect(error?.code).toBe(PG.insufficientPrivilege);
    });
  });

  describe("watchlist_items: tope y RLS", () => {
    let watchlistA: string;

    beforeAll(async () => {
      watchlistA = (await getWatchlistId(a.client)) ?? "";
      expect(watchlistA).not.toBe("");
    });

    it("cada persona ve solo su lista", async () => {
      expect(await getWatchlistItems(b.client)).toEqual([]);
      const idB = await getWatchlistId(b.client);
      expect(idB).not.toBeNull();
      expect(idB).not.toBe(watchlistA);
    });

    it("no se puede colgar un símbolo de la lista de otra persona", async () => {
      const { error } = await follow(b, watchlistA, [priced]);
      expect(error).not.toBeNull();
      expect([
        PG.insufficientPrivilege,
        PG.foreignKeyViolation,
      ] as string[]).toContain(error?.code);
    });

    it("una lista de 50 símbolos entra (en un solo INSERT) y el 51.º lo rechaza el trigger", async () => {
      const first = full.slice(0, WATCHLIST_MAX);
      const ok = await follow(a, watchlistA, first);
      expect(ok.error).toBeNull();
      expect(await getWatchlistItems(a.client)).toHaveLength(WATCHLIST_MAX);

      const over = await follow(a, watchlistA, [full[WATCHLIST_MAX]!]);
      expect(over.error?.code).toBe(PG.checkViolation);
      expect(await getWatchlistItems(a.client)).toHaveLength(WATCHLIST_MAX);
    });

    it("repetir un símbolo ya seguido es una violación de unicidad, no del tope", async () => {
      // Con la lista llena, el trigger corta primero; se libera un lugar para ver la otra regla.
      const removed = await a.client
        .from("watchlist_items")
        .delete()
        .eq("instrument_id", full[0]!);
      expect(removed.error).toBeNull();
      const dup = await follow(a, watchlistA, [full[1]!]);
      expect(dup.error?.code).toBe(PG.uniqueViolation);
    });

    it("al quitar uno vuelve a haber lugar, y el mover un símbolo a una lista llena también se rechaza", async () => {
      const again = await follow(a, watchlistA, [full[WATCHLIST_MAX]!]);
      expect(again.error).toBeNull(); // 49 + 1 = 50: llena otra vez

      // Segunda lista (vacía) con un símbolo: moverlo a la llena tiene que fallar.
      const second = must(
        await a.client
          .from("watchlists")
          .insert({ user_id: a.id, name: "Otra" })
          .select("id")
          .single(),
        "segunda lista",
      ).id;
      const placed = await follow(a, second, [priced]);
      expect(placed.error).toBeNull(); // el trigger cuenta por lista: 0 en la segunda

      const move = await a.client
        .from("watchlist_items")
        .update({ watchlist_id: watchlistA })
        .eq("instrument_id", priced);
      expect(move.error?.code).toBe(PG.checkViolation);
    });

    it("la ficha de un solo instrumento se arma con lo que hay en la base", async () => {
      // Con `now` en 2025-09-03 la ventana de un año incluye todos los cierres de `priced`.
      const rows = await loadWatchlist(
        a.client,
        new Date("2025-09-03T12:00:00Z"),
      );
      const view = rows.find((r) => r.instrumentId === priced);
      expect(view).toBeDefined();
      expect(view?.price?.toFixed()).toBe("111.123456");
      expect(view?.priceSource).toBe("close");
      expect(view?.dayChange?.toFixed()).toBe("1.123456");
      expect(view?.range?.low.toFixed()).toBe("50");
      expect(view?.range?.high.toFixed()).toBe("120");
      expect(view?.spark).toEqual([50, 100, 80, 120, 110, 111.123456]);
      // Los que no tienen cierres siguen en la lista, sin precio.
      const noPrice = rows.filter((r) => r.price === null);
      expect(noPrice.length).toBeGreaterThan(0);
      // El orden es alfabético por símbolo.
      const symbols = rows.map((r) => r.symbol);
      expect(symbols).toEqual([...symbols].sort());
    });
  });
});
