import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeEngine, d, type Dec, type Transaction } from "@/lib/engine";
import { parseDeltaCsv, toEngineTransactions } from "@/lib/importers";
import type { TransactionInput } from "@/lib/validation/transaction";
import {
  draftsToRpcRows,
  inputToInsertRow,
  inputToTransaction,
  inputToValueColumns,
  rowToTransaction,
} from "../mappers";
import { transactionRowSchema, type TransactionRow } from "../rows";
import { fixtureInstruments, fixtureRows } from "./fixture";

const CSV = readFileSync(
  resolve(process.cwd(), "lib/engine/__fixtures__/delta_export.csv"),
  "utf8",
);
const ACCOUNT = "acc-1";

const row = (overrides: Partial<TransactionRow>): TransactionRow => ({
  id: "row-1",
  type: "BUY",
  instrument_id: "inst-voo",
  executed_at: "2026-03-09T22:34:00+00:00",
  quantity: "3.00000000",
  price: "575.24000000",
  amount: null,
  fee: "1.0000",
  currency: "USD",
  split_ratio: null,
  notes: null,
  source: "delta_csv",
  external_id: "delta:x",
  created_at: "2026-09-24T10:00:00+00:00",
  seq: 1,
  ...overrides,
});
const symbols = new Map([
  ["inst-voo", "VOO"],
  ["inst-meli", "MELI"],
]);

describe("rowToTransaction", () => {
  it("BUY: los montos en texto de la base entran al motor sin perder decimales", () => {
    const tx = rowToTransaction(row({}), ACCOUNT, symbols);
    expect(tx).toMatchObject({
      id: "row-1",
      accountId: ACCOUNT,
      type: "BUY",
      symbol: "VOO",
      currency: "USD",
    });
    if (tx.type !== "BUY") throw new Error();
    expect(tx.quantity.toFixed()).toBe("3");
    expect(tx.price.toFixed()).toBe("575.24");
    expect(tx.fee.toFixed()).toBe("1");
    expect(tx.executedAt).toEqual(new Date("2026-03-09T22:34:00Z"));
    expect(tx.createdAt).toEqual(new Date("2026-09-24T10:00:00Z"));
  });

  it("un precio con 8 decimales y una cantidad fraccionaria se conservan exactos", () => {
    const tx = rowToTransaction(
      row({ quantity: "0.12345678", price: "1234.56789012" }),
      ACCOUNT,
      symbols,
    );
    if (tx.type !== "BUY") throw new Error();
    expect(tx.quantity.toFixed()).toBe("0.12345678");
    expect(tx.price.toFixed()).toBe("1234.56789012");
  });

  it("SELL, DIVIDEND y SPLIT", () => {
    const sell = rowToTransaction(row({ type: "SELL" }), ACCOUNT, symbols);
    expect(sell.type).toBe("SELL");
    const dividend = rowToTransaction(
      row({
        type: "DIVIDEND",
        quantity: null,
        price: null,
        amount: "2.5000",
        fee: "0.0000",
      }),
      ACCOUNT,
      symbols,
    );
    expect(dividend).toMatchObject({ type: "DIVIDEND", symbol: "VOO" });
    expect((dividend as { amount: Dec }).amount.toFixed()).toBe("2.5");
    const split = rowToTransaction(
      row({
        type: "SPLIT",
        quantity: null,
        price: null,
        split_ratio: "10.00000000",
        fee: "0.0000",
      }),
      ACCOUNT,
      symbols,
    );
    expect((split as { splitRatio: Dec }).splitRatio.toFixed()).toBe("10");
  });

  it.each(["DEPOSIT", "WITHDRAWAL", "FEE", "TAX", "INTEREST"] as const)(
    "%s: movimiento de efectivo, con o sin símbolo",
    (type) => {
      const bare = rowToTransaction(
        row({
          type,
          instrument_id: null,
          quantity: null,
          price: null,
          amount: "100.0000",
          fee: "0.0000",
        }),
        ACCOUNT,
        symbols,
      );
      expect(bare).toMatchObject({ type, symbol: null });
      const tagged = rowToTransaction(
        row({
          type,
          instrument_id: "inst-meli",
          quantity: null,
          price: null,
          amount: "100.0000",
          fee: "0.0000",
        }),
        ACCOUNT,
        symbols,
      );
      expect(tagged).toMatchObject({ type, symbol: "MELI" });
    },
  );

  it("un interés negativo (margen) conserva el signo", () => {
    const tx = rowToTransaction(
      row({
        type: "INTEREST",
        instrument_id: null,
        quantity: null,
        price: null,
        amount: "-3.2500",
        fee: "0.0000",
      }),
      ACCOUNT,
      symbols,
    );
    expect((tx as { amount: Dec }).amount.toFixed()).toBe("-3.25");
  });

  it("datos inconsistentes (que los CHECK impiden) lanzan con un mensaje claro", () => {
    expect(() =>
      rowToTransaction(row({ instrument_id: null }), ACCOUNT, symbols),
    ).toThrow(/no tiene instrumento/);
    expect(() =>
      rowToTransaction(row({ instrument_id: "desconocido" }), ACCOUNT, symbols),
    ).toThrow(/no tiene instrumento/);
    expect(() =>
      rowToTransaction(row({ quantity: null }), ACCOUNT, symbols),
    ).toThrow(/no tiene cantidad/);
    expect(() =>
      rowToTransaction(row({ price: null }), ACCOUNT, symbols),
    ).toThrow(/no tiene precio/);
    expect(() =>
      rowToTransaction(
        row({ type: "DEPOSIT", amount: null }),
        ACCOUNT,
        symbols,
      ),
    ).toThrow(/no tiene monto/);
    expect(() =>
      rowToTransaction(
        row({ type: "SPLIT", split_ratio: null }),
        ACCOUNT,
        symbols,
      ),
    ).toThrow(/razón del split/);
  });
});

describe("transactionRowSchema", () => {
  it("acepta una fila como la devuelve PostgREST y rechaza tipos raros", () => {
    expect(transactionRowSchema.safeParse(row({})).success).toBe(true);
    expect(
      transactionRowSchema.safeParse({ ...row({}), type: "OTRO" }).success,
    ).toBe(false);
    expect(
      transactionRowSchema.safeParse({ ...row({}), quantity: 3 }).success,
    ).toBe(false); // número: no vino con ::text
    expect(
      transactionRowSchema.safeParse({ ...row({}), seq: "1" }).success,
    ).toBe(false);
  });
});

describe("draftsToRpcRows", () => {
  const parsed = parseDeltaCsv(CSV);

  it("una fila por borrador, en el mismo orden y con los montos como strings", () => {
    const rows = draftsToRpcRows(parsed.transactions);
    expect(rows).toHaveLength(parsed.transactions.length);
    expect(rows.map((r) => r.external_id)).toEqual(
      parsed.transactions.map((t) => t.externalId),
    );
    for (const r of rows) {
      for (const key of [
        "quantity",
        "price",
        "amount",
        "fee",
        "split_ratio",
      ] as const) {
        if (r[key] !== undefined) expect(typeof r[key]).toBe("string");
      }
      expect(r.executed_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    }
  });

  it("operaciones: cantidad, precio y comisión; efectivo: solo monto y sin símbolo", () => {
    const rows = draftsToRpcRows(parsed.transactions);
    const voo = rows.find((r) => r.type === "BUY" && r.symbol === "VOO");
    expect(voo).toMatchObject({ currency: "USD" });
    expect(voo?.quantity).toBeDefined();
    expect(voo?.price).toBeDefined();
    expect(voo?.fee).toBeDefined();
    expect(voo?.amount).toBeUndefined();
    const deposit = rows.find((r) => r.type === "DEPOSIT");
    expect(deposit?.symbol).toBeNull();
    expect(deposit?.amount).toBeDefined();
    expect(deposit?.quantity).toBeUndefined();
    expect(deposit?.fee).toBeUndefined(); // el RPC pone 0: `fee = 0` fuera de BUY/SELL lo exige un CHECK
  });

  it("los números exactos de las operaciones sobreviven al viaje como texto", () => {
    const rows = draftsToRpcRows(parsed.transactions);
    const first = parsed.transactions.find((t) => t.type === "BUY");
    const rpc = rows.find((r) => r.external_id === first?.externalId);
    if (first?.type !== "BUY") throw new Error();
    expect(rpc?.quantity).toBe(first.quantity.toFixed());
    expect(rpc?.price).toBe(first.price.toFixed());
  });
});

describe("importador → base → motor: los números de la sección 8.3", () => {
  const dbRows = fixtureRows();
  const symbolById = new Map(fixtureInstruments().map((i) => [i.id, i.symbol]));
  const txs: Transaction[] = dbRows.map((r) =>
    rowToTransaction(r, ACCOUNT, symbolById),
  );
  const result = computeEngine(txs);
  const pos = (symbol: string) =>
    result.positions.find((p) => p.symbol === symbol)!;

  it("las filas de la base pasan la validación del borde", () => {
    for (const r of dbRows)
      expect(transactionRowSchema.safeParse(r).success, r.id).toBe(true);
  });

  it("efectivo: 882.745", () => {
    expect(result.cash.toFixed()).toBe("882.745");
  });

  it("costo base de las posiciones abiertas", () => {
    expect(pos("VOO").quantity.toFixed()).toBe("8.95");
    expect(pos("VOO").costBasis.toFixed()).toBe("5724.77");
    expect(pos("SOXX").costBasis.toFixed()).toBe("2069.5");
    expect(pos("FSLY").costBasis.toFixed()).toBe("346.8");
    expect(pos("ILF").costBasis.toFixed()).toBe("331.6");
    expect(pos("NFLX").costBasis.toFixed()).toBe("191.6");
    expect(result.totals.openCostBasis.toFixed()).toBe("8664.27");
  });

  it("ganancia realizada de las posiciones cerradas: 247.015", () => {
    expect(pos("MELI").realizedPnl.toFixed()).toBe("180.55");
    expect(pos("URTH").realizedPnl.toFixed()).toBe("42.7");
    expect(pos("KOS").realizedPnl.toFixed()).toBe("11.135");
    expect(pos("QCOM").realizedPnl.toFixed()).toBe("7.52");
    expect(pos("TTWO").realizedPnl.toFixed()).toBe("5.11");
    expect(result.totals.realizedPnl.toFixed()).toBe("247.015");
  });

  it("es idéntico a calcular directamente con los borradores del importador", () => {
    const direct = computeEngine(
      toEngineTransactions(parseDeltaCsv(CSV).transactions, {
        accountId: ACCOUNT,
        importedAt: new Date("2026-09-24T10:00:00Z"),
      }),
    );
    expect(result.cash.toFixed()).toBe(direct.cash.toFixed());
    expect(
      result.positions.map((p) => [
        p.symbol,
        p.quantity.toFixed(),
        p.costBasis.toFixed(),
        p.realizedPnl.toFixed(),
      ]),
    ).toEqual(
      direct.positions.map((p) => [
        p.symbol,
        p.quantity.toFixed(),
        p.costBasis.toFixed(),
        p.realizedPnl.toFixed(),
      ]),
    );
  });

  it("sin errores del motor y sin efectivo negativo al final", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.issues.map((i) => i.code)).not.toContain("NEGATIVE_CASH");
  });
});

describe("inputToTransaction / inputToInsertRow (alta manual)", () => {
  const at = new Date("2026-09-23T15:00:00Z");
  const notes = "prueba";
  const ctx = { userId: "u1", accountId: ACCOUNT, instrumentId: "inst-ddog" };

  const ddog: TransactionInput = {
    type: "BUY",
    symbol: "DDOG",
    quantity: d("2"),
    price: d("251.41"),
    fee: d("1"),
    executedAt: at,
    notes,
  };

  it("BUY → Transaction del motor con los mismos montos", () => {
    const tx = inputToTransaction(ddog, {
      id: "new",
      accountId: ACCOUNT,
      createdAt: at,
    });
    expect(tx).toMatchObject({
      id: "new",
      accountId: ACCOUNT,
      type: "BUY",
      symbol: "DDOG",
      currency: "USD",
      notes,
    });
    const result = computeEngine([tx]);
    // Sección 8.3: costo base 503.82 (2 × 251.41 + 1.00) y, con el efectivo de la importación, 378.925.
    expect(result.positions[0]?.costBasis.toFixed()).toBe("503.82");
  });

  it("BUY → fila de inserción: números lossless, origen manual y sin external_id", () => {
    const row = inputToInsertRow(ddog, ctx);
    expect(row).toEqual({
      type: "BUY",
      instrument_id: "inst-ddog",
      executed_at: "2026-09-23T15:00:00.000Z",
      quantity: 2,
      price: 251.41,
      amount: null,
      fee: 1,
      split_ratio: null,
      notes,
      user_id: "u1",
      account_id: ACCOUNT,
      currency: "USD",
      source: "manual",
    });
    expect(row).not.toHaveProperty("external_id");
    expect(JSON.stringify(row.price)).toBe("251.41");
  });

  it("los montos al límite de dígitos (15 cifras significativas) viajan exactos", () => {
    const row = inputToInsertRow(
      {
        ...ddog,
        type: "BUY",
        quantity: d("9999999.99999999"),
        price: d("0.00000001"),
        fee: d("99999999999.9999"),
      } as TransactionInput,
      ctx,
    );
    expect(JSON.stringify(row.quantity)).toBe("9999999.99999999");
    expect(JSON.stringify(row.price)).toBe("1e-8");
    expect(JSON.stringify(row.fee)).toBe("99999999999.9999");
    expect(d(String(row.price)).toFixed()).toBe("0.00000001"); // PostgREST lo lee como 1e-8 exacto
  });

  it("cada tipo deja en null los campos que no le corresponden", () => {
    const dividend = inputToInsertRow(
      {
        type: "DIVIDEND",
        symbol: "VOO",
        amount: d("2.5"),
        executedAt: at,
        notes: null,
      },
      ctx,
    );
    expect(dividend).toMatchObject({
      type: "DIVIDEND",
      quantity: null,
      price: null,
      amount: 2.5,
      fee: 0,
      split_ratio: null,
      notes: null,
    });
    const split = inputToInsertRow(
      {
        type: "SPLIT",
        symbol: "NVDA",
        splitRatio: d("0.1"),
        executedAt: at,
        notes: null,
      },
      ctx,
    );
    expect(split).toMatchObject({
      type: "SPLIT",
      quantity: null,
      price: null,
      amount: null,
      fee: 0,
      split_ratio: 0.1,
    });
    const deposit = inputToInsertRow(
      {
        type: "DEPOSIT",
        symbol: null,
        amount: d("4200"),
        executedAt: at,
        notes: null,
      },
      { ...ctx, instrumentId: null },
    );
    expect(deposit).toMatchObject({
      type: "DEPOSIT",
      instrument_id: null,
      amount: 4200,
      quantity: null,
      fee: 0,
    });
    const interest = inputToInsertRow(
      {
        type: "INTEREST",
        symbol: null,
        amount: d("-3.25"),
        executedAt: at,
        notes: null,
      },
      { ...ctx, instrumentId: null },
    );
    expect(interest).toMatchObject({ type: "INTEREST", amount: -3.25 });
  });

  it("los valores de columnas sirven para editar: al cambiar de tipo se borran los campos viejos", () => {
    const toDeposit = inputToValueColumns(
      {
        type: "DEPOSIT",
        symbol: null,
        amount: d("100"),
        executedAt: at,
        notes: null,
      },
      null,
    );
    expect(toDeposit).toEqual({
      type: "DEPOSIT",
      instrument_id: null,
      executed_at: "2026-09-23T15:00:00.000Z",
      quantity: null,
      price: null,
      amount: 100,
      fee: 0,
      split_ratio: null,
      notes: null,
    });
    expect(toDeposit).not.toHaveProperty("user_id");
    expect(toDeposit).not.toHaveProperty("source");
    expect(toDeposit).not.toHaveProperty("external_id");
  });

  it("cada tipo del formulario se convierte a su Transaction del motor", () => {
    const mk = (input: TransactionInput) =>
      inputToTransaction(input, { id: "x", accountId: ACCOUNT, createdAt: at });
    expect(
      mk({
        type: "SELL",
        symbol: "VOO",
        quantity: d("1"),
        price: d("10"),
        fee: d("0"),
        executedAt: at,
        notes: null,
      }).type,
    ).toBe("SELL");
    expect(
      mk({
        type: "DIVIDEND",
        symbol: "VOO",
        amount: d("1"),
        executedAt: at,
        notes: null,
      }),
    ).toMatchObject({ type: "DIVIDEND", symbol: "VOO" });
    expect(
      mk({
        type: "SPLIT",
        symbol: "VOO",
        splitRatio: d("2"),
        executedAt: at,
        notes: null,
      }),
    ).toMatchObject({ type: "SPLIT" });
    for (const type of [
      "DEPOSIT",
      "WITHDRAWAL",
      "FEE",
      "TAX",
      "INTEREST",
    ] as const) {
      expect(
        mk({ type, symbol: null, amount: d("5"), executedAt: at, notes: null }),
      ).toMatchObject({ type, symbol: null });
    }
  });
});
