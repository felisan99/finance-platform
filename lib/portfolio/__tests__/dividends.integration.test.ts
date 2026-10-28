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
import { loadPendingDividends } from "../dividends-data";
import { dividendToInsertRows } from "../mappers";
import type { PortfolioRef } from "../portfolio-scope";
import { listPortfolios, loadPortfolioSnapshot } from "../queries";

// Dividendos automáticos contra finance-dev (`pnpm test:integration`): un instrumento y un
// dividendo de prueba (datos de mercado, con la clave secreta) y dos personas. Se borran al final.

describe("dividendos detectados (integración, finance-dev)", () => {
  let admin: DbClient;
  let a: TestUser;
  let b: TestUser;
  let portfolio: PortfolioRef;
  let instrumentId: string;
  let eventId: string;
  const now = new Date("2026-09-30T21:00:00Z");

  const pending = async () =>
    loadPendingDividends(
      a.client,
      await loadPortfolioSnapshot(a.client, portfolio),
      now,
    );

  beforeAll(async () => {
    admin = createAdmin();
    a = await createTestUser(admin, "div-a");
    b = await createTestUser(admin, "div-b");

    const symbol = randomSymbol();
    const instrument = await admin
      .from("instruments")
      .insert({ symbol, name: "Instrumento de prueba", type: "STOCK" })
      .select("id")
      .single();
    if (instrument.error) throw new Error(instrument.error.message);
    instrumentId = instrument.data.id;
    const action = await admin
      .from("corporate_actions")
      .insert({
        instrument_id: instrumentId,
        type: "DIVIDEND",
        ex_date: "2026-03-13",
        amount: 0.51,
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
        executed_at: "2026-01-02T15:00:00Z",
        amount: 10000,
        fee: 0,
        currency: "USD",
      },
      {
        user_id: a.id,
        account_id: portfolio.account.id,
        type: "BUY",
        instrument_id: instrumentId,
        executed_at: "2026-01-05T15:00:00Z",
        quantity: 100,
        price: 60,
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

  it("propone el dividendo con la retención por defecto del 30 %", async () => {
    const { rate, items } = await pending();
    expect(rate.toFixed()).toBe("0.3");
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe(`${portfolio.account.id}:${eventId}`);
    expect(items[0]!.suggestion.gross.toFixed()).toBe("51");
    expect(items[0]!.suggestion.withholding.toFixed()).toBe("15.3");
  });

  it("la persona elige su retención, dentro del rango", async () => {
    const ok = await a.client
      .from("profiles")
      .update({ dividend_withholding_rate: 0.15 })
      .eq("id", a.id);
    expect(ok.error).toBeNull();
    expect((await pending()).items[0]!.suggestion.withholding.toFixed()).toBe(
      "7.65",
    );

    const bad = await a.client
      .from("profiles")
      .update({ dividend_withholding_rate: 1.5 })
      .eq("id", a.id);
    expect(bad.error?.code).toBe(PG.checkViolation);
  });

  it("descartar lo oculta; otra persona no puede descartar por ella ni ver sus descartes", async () => {
    const intrusion = await b.client.from("dividend_dismissals").insert({
      user_id: b.id,
      account_id: portfolio.account.id,
      corporate_action_id: eventId,
    });
    expect(intrusion.error?.code).toBe(PG.foreignKeyViolation);

    const own = await a.client.from("dividend_dismissals").insert({
      user_id: a.id,
      account_id: portfolio.account.id,
      corporate_action_id: eventId,
    });
    expect(own.error).toBeNull();
    expect((await pending()).items).toEqual([]);
    expect(
      (await b.client.from("dividend_dismissals").select("account_id")).data,
    ).toEqual([]);

    await a.client
      .from("dividend_dismissals")
      .delete()
      .eq("corporate_action_id", eventId);
    expect((await pending()).items).toHaveLength(1);
  });

  it("confirmado una vez: no se puede guardar dos veces ni se vuelve a proponer", async () => {
    const [item] = (await pending()).items;
    const rows = dividendToInsertRows(item!.suggestion, {
      userId: a.id,
      accountId: portfolio.account.id,
      instrumentId,
      currency: "USD",
    });
    expect((await a.client.from("transactions").insert(rows)).error).toBeNull();
    const again = await a.client.from("transactions").insert(rows);
    expect(again.error?.code).toBe(PG.uniqueViolation);
    expect((await pending()).items).toEqual([]);

    const snapshot = await loadPortfolioSnapshot(a.client, portfolio);
    expect(snapshot.engine.totals.dividends.toFixed()).toBe("51");
    expect(snapshot.engine.totals.taxes.toFixed()).toBe("7.65");
  });
});
