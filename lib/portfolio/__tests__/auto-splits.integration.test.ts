import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PG,
  createAdmin,
  createTestUser,
  deleteTestUser,
  randomSymbol,
  type DbClient,
  type TestUser,
} from "@/lib/db/__tests__/integration-helpers";
import { loadScopeSnapshotWithSplits } from "../auto-splits";
import type { PortfolioRef } from "../portfolio-scope";
import { getTransactionRows, listPortfolios } from "../queries";

// Splits automáticos contra finance-dev (`pnpm test:integration`): un instrumento y un split de
// prueba (datos de mercado, con la clave secreta) y dos personas, que escriben con su sesión
// (RLS). Se borran al final.

describe("splits automáticos (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;
  let portfolio: PortfolioRef;
  let instrumentId: string;
  let eventId: string;
  let symbol: string;
  const now = new Date("2026-11-06T21:00:00Z");

  const load = () =>
    loadScopeSnapshotWithSplits(a.client, { kind: "one", portfolio }, now);
  const splitsOf = async () =>
    (await getTransactionRows(a.client, portfolio.account.id)).filter(
      (row) => row.type === "SPLIT",
    );

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "split-a");
    b = await createTestUser(admin, "split-b");

    symbol = randomSymbol();
    const instrument = await admin
      .from("instruments")
      .insert({ symbol, name: "Instrumento de prueba", type: "ETF" })
      .select("id")
      .single();
    if (instrument.error) throw new Error(instrument.error.message);
    instrumentId = instrument.data.id;
    const action = await admin
      .from("corporate_actions")
      .insert({
        instrument_id: instrumentId,
        type: "SPLIT",
        ex_date: "2026-11-05",
        ratio: 3,
      })
      .select("id")
      .single();
    if (action.error) throw new Error(action.error.message);
    eventId = action.data.id;

    [portfolio] = (await listPortfolios(a.client)) as [PortfolioRef];
    const rows = await a.client.from("transactions").insert([
      {
        user_id: a.id,
        account_id: portfolio.account.id,
        type: "DEPOSIT",
        executed_at: "2026-05-01T15:00:00Z",
        amount: 10000,
        fee: 0,
        currency: "USD",
      },
      {
        user_id: a.id,
        account_id: portfolio.account.id,
        type: "BUY",
        instrument_id: instrumentId,
        executed_at: "2026-05-12T15:00:00Z",
        quantity: 5,
        price: 500,
        fee: 0,
        currency: "USD",
      },
    ]);
    if (rows.error) throw new Error(rows.error.message);
  });

  afterAll(async () => {
    await deleteTestUser(admin, a);
    await deleteTestUser(admin, b);
    if (instrumentId)
      await admin.from("instruments").delete().eq("id", instrumentId);
  });

  it("al abrir la cartera agrega el split una sola vez, con la sesión de la persona", async () => {
    const snapshot = await load();
    const position = snapshot.valued.positions.find((p) => p.symbol === symbol);
    expect(position?.quantity.toFixed()).toBe("15");
    expect(snapshot.engine.issues).toEqual([]);

    const [split, ...rest] = await splitsOf();
    expect(rest).toEqual([]);
    expect(split).toMatchObject({
      source: "auto_split",
      external_id: `split:${eventId}`,
      executed_at: "2026-11-05T09:00:00+00:00",
    });
    expect(Number(split!.split_ratio)).toBe(3);

    // Volver a abrir no lo duplica, y la base tampoco deja guardarlo dos veces.
    await load();
    expect(await splitsOf()).toHaveLength(1);
    const again = await a.client.from("transactions").insert({
      user_id: a.id,
      account_id: portfolio.account.id,
      type: "SPLIT",
      instrument_id: instrumentId,
      executed_at: "2026-11-05T09:00:00Z",
      split_ratio: 3,
      fee: 0,
      currency: "USD",
      source: "auto_split",
      external_id: `split:${eventId}`,
    });
    expect(again.error?.code).toBe(PG.uniqueViolation);
  });

  it("otra persona no puede marcar como borrado un split de una cuenta ajena ni ver los descartes", async () => {
    const intrusion = await b.client.from("split_dismissals").insert({
      user_id: b.id,
      account_id: portfolio.account.id,
      corporate_action_id: eventId,
    });
    expect(intrusion.error?.code).toBe(PG.foreignKeyViolation);
    expect(
      (await b.client.from("split_dismissals").select("account_id")).data,
    ).toEqual([]);
  });

  it("borrado por la persona (con su descarte), no se vuelve a agregar", async () => {
    const [split] = await splitsOf();
    const dismissed = await a.client.from("split_dismissals").insert({
      user_id: a.id,
      account_id: portfolio.account.id,
      corporate_action_id: eventId,
    });
    expect(dismissed.error).toBeNull();
    const removed = await a.client
      .from("transactions")
      .delete()
      .eq("id", split!.id);
    expect(removed.error).toBeNull();

    const snapshot = await load();
    expect(await splitsOf()).toEqual([]);
    expect(
      snapshot.valued.positions
        .find((p) => p.symbol === symbol)
        ?.quantity.toFixed(),
    ).toBe("5");
  });
});
