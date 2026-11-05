import { describe, expect, it } from "vitest";
import { d, marketDay } from "@/lib/engine";
import { splitEventIdOf } from "../auto-splits";
import {
  rowToTransaction,
  splitInstant,
  splitToInsertRow,
  splitToTransaction,
} from "../mappers";
import { transactionRowSchema } from "../rows";

const EVENT = "ac3c7511-d469-4ba9-9096-6d8499b4a5ba";
const split = {
  eventId: EVENT,
  symbol: "SOXX",
  exDate: "2026-11-05",
  ratio: d("3.00000000"),
};

describe("splitInstant", () => {
  it("cae en el mismo día de mercado, antes de la apertura, con o sin horario de verano", () => {
    for (const exDate of ["2026-11-05", "2026-07-02", "2024-03-07"]) {
      const instant = splitInstant(exDate);
      expect(marketDay(instant)).toBe(exDate);
      // 13:30Z es la apertura más temprana del año (horario de verano).
      expect(instant.getUTCHours()).toBeLessThan(13);
    }
  });
});

describe("splitToInsertRow / splitToTransaction", () => {
  const ctx = {
    userId: "user-1",
    accountId: "acc-1",
    instrumentId: "inst-soxx",
    currency: "USD",
  };

  it("arma la fila automática con su external_id y la razón exacta", () => {
    expect(splitToInsertRow(split, ctx)).toEqual({
      user_id: "user-1",
      account_id: "acc-1",
      instrument_id: "inst-soxx",
      type: "SPLIT",
      executed_at: "2026-11-05T09:00:00.000Z",
      split_ratio: 3,
      currency: "USD",
      source: "auto_split",
      external_id: `split:${EVENT}`,
      fee: 0,
      notes: null,
    });
    expect(
      splitToInsertRow({ ...split, ratio: d("0.33333333") }, ctx).split_ratio,
    ).toBe(0.33333333);
  });

  it("la fila guardada vuelve al motor como el mismo split que se validó", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const validated = splitToTransaction(split, {
      accountId: "acc-1",
      currency: "USD",
      now,
    });
    const insert = splitToInsertRow(split, ctx);
    const stored = transactionRowSchema.parse({
      id: "row-1",
      type: "SPLIT",
      instrument_id: "inst-soxx",
      executed_at: "2026-11-05T09:00:00+00:00",
      quantity: null,
      price: null,
      amount: null,
      fee: "0.0000",
      currency: "USD",
      split_ratio: String(insert.split_ratio),
      notes: null,
      source: insert.source,
      external_id: insert.external_id,
      created_at: now.toISOString(),
      seq: 1,
    });
    const back = rowToTransaction(
      stored,
      "acc-1",
      new Map([["inst-soxx", "SOXX"]]),
    );
    expect(back.type).toBe("SPLIT");
    expect(back.symbol).toBe(validated.symbol);
    expect(back.executedAt).toEqual(validated.executedAt);
    if (back.type === "SPLIT" && validated.type === "SPLIT") {
      expect(back.splitRatio.toFixed()).toBe(validated.splitRatio.toFixed());
    }
  });
});

describe("splitEventIdOf", () => {
  it("solo reconoce los splits automáticos con un id válido", () => {
    expect(
      splitEventIdOf({ source: "auto_split", external_id: `split:${EVENT}` }),
    ).toBe(EVENT);
    expect(
      splitEventIdOf({ source: "manual", external_id: `split:${EVENT}` }),
    ).toBeNull();
    expect(
      splitEventIdOf({ source: "auto_split", external_id: "split:nope" }),
    ).toBeNull();
    expect(
      splitEventIdOf({ source: "auto_split", external_id: null }),
    ).toBeNull();
    expect(
      splitEventIdOf({ source: "auto_dividend", external_id: `div:${EVENT}` }),
    ).toBeNull();
  });
});
