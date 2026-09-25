import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { d } from "@/lib/engine";
import { parseSimpleCsv } from "@/lib/importers";
import { buildTransactionsCsv } from "../csv-export";
import type { TransactionRow } from "../rows";
import { fixtureInstruments, fixtureRows } from "./fixture";

// Exportar → importar es ida y vuelta: el CSV que baja «Exportar CSV» tiene que poder subirse de
// nuevo (backup y restauración, y la mudanza de la base de desarrollo a la de producción).

const NOW = new Date("2026-09-25T12:00:00Z");

/** Lo que el importador entiende de una fila de la base, para comparar en texto canónico. */
function summarizeRow(
  row: TransactionRow,
  symbols: ReadonlyMap<string, string>,
) {
  const num = (value: string | null) =>
    value === null ? null : d(value).toFixed();
  const isTrade = row.type === "BUY" || row.type === "SELL";
  return {
    type: row.type,
    symbol: row.instrument_id ? (symbols.get(row.instrument_id) ?? null) : null,
    executedAt: new Date(row.executed_at).toISOString(),
    quantity: isTrade ? num(row.quantity) : null,
    price: isTrade ? num(row.price) : null,
    fee: isTrade ? num(row.fee) : null,
    amount: isTrade || row.type === "SPLIT" ? null : num(row.amount),
    splitRatio: row.type === "SPLIT" ? num(row.split_ratio) : null,
    notes: row.notes,
  };
}

function summarizeParsed(result: ReturnType<typeof parseSimpleCsv>) {
  return result.transactions.map((tx) => ({
    type: tx.type,
    symbol: "symbol" in tx ? tx.symbol : null,
    executedAt: tx.executedAt.toISOString(),
    quantity: "quantity" in tx ? tx.quantity.toFixed() : null,
    price: "price" in tx ? tx.price.toFixed() : null,
    fee: "fee" in tx ? tx.fee.toFixed() : null,
    amount: "amount" in tx ? tx.amount.toFixed() : null,
    splitRatio: "splitRatio" in tx ? tx.splitRatio.toFixed() : null,
    notes: tx.notes ?? null,
  }));
}

describe("ida y vuelta con el historial del fixture de Delta", () => {
  it("todo lo exportado se vuelve a importar igual, sin errores", () => {
    const rows = fixtureRows();
    const symbols = new Map(fixtureInstruments().map((i) => [i.id, i.symbol]));
    const csv = buildTransactionsCsv(rows, symbols);
    const parsed = parseSimpleCsv(csv, NOW);

    expect(parsed.fatal).toBeNull();
    expect(parsed.errors).toEqual([]);
    expect(parsed.skipped).toEqual([]);
    expect(rows.length).toBeGreaterThan(20);
    expect(summarizeParsed(parsed)).toEqual(
      rows.map((row) => summarizeRow(row, symbols)),
    );
  });

  it("la clave de deduplicación no cambia entre dos importaciones del mismo export", () => {
    const rows = fixtureRows();
    const symbols = new Map(fixtureInstruments().map((i) => [i.id, i.symbol]));
    const csv = buildTransactionsCsv(rows, symbols);
    const ids = (text: string) =>
      parseSimpleCsv(text, NOW).transactions.map((t) => t.externalId);
    expect(ids(csv)).toEqual(ids(csv));
    expect(new Set(ids(csv)).size).toBe(rows.length);
  });
});

// --- Propiedad: cualquier libro válido sobrevive a exportar e importar ----------------------------

/** Decimal en texto con `dp` decimales a partir de un entero (`n = 123456789`, dp 8 → `1.23456789`). */
const decimal = (n: number, dp: number): string => {
  const digits = String(n).padStart(dp + 1, "0");
  return `${digits.slice(0, digits.length - dp)}.${digits.slice(digits.length - dp)}`;
};

const positive = (dp: number) =>
  fc.integer({ min: 1, max: 999_999_999_999_999 }).map((n) => decimal(n, dp));
const nonNegative = (dp: number) =>
  fc.integer({ min: 0, max: 999_999_999_999_999 }).map((n) => decimal(n, dp));

const SYMBOL_IDS = new Map([
  ["i-voo", "VOO"],
  ["i-aapl", "AAPL"],
  ["i-brk", "BRK-B"],
]);
const symbolId = fc.constantFrom(...SYMBOL_IDS.keys());

// Notas que ponen a prueba el entrecomillado y la defensa contra fórmulas.
const notes = fc.constantFrom(
  null,
  "primera compra",
  "con, coma",
  'con "comillas"',
  "=SUMA(A1)",
  "+5 por ciento",
  "-descuento",
  "@usuario",
  "áéíóú ñ",
);

const executedAt = fc
  .date({
    min: new Date("1990-01-02T00:00:00Z"),
    max: new Date("2026-09-20T00:00:00Z"),
    noInvalidDate: true,
  })
  .map((date) => date.toISOString());

const base = fc.record({ executed_at: executedAt, notes });

const rowArb: fc.Arbitrary<TransactionRow> = fc
  .oneof(
    fc.record({
      type: fc.constantFrom("BUY" as const, "SELL" as const),
      instrument_id: symbolId,
      quantity: positive(8),
      price: nonNegative(8),
      fee: nonNegative(4),
      amount: fc.constant(null),
      split_ratio: fc.constant(null),
    }),
    fc.record({
      type: fc.constant("DIVIDEND" as const),
      instrument_id: symbolId,
      quantity: fc.constant(null),
      price: fc.constant(null),
      fee: fc.constant("0.0000"),
      amount: positive(4),
      split_ratio: fc.constant(null),
    }),
    fc.record({
      type: fc.constant("SPLIT" as const),
      instrument_id: symbolId,
      quantity: fc.constant(null),
      price: fc.constant(null),
      fee: fc.constant("0.0000"),
      amount: fc.constant(null),
      // Nunca exactamente 1: un split 1 por 1 no cambia nada y el importador lo rechaza.
      split_ratio: fc
        .integer({ min: 1, max: 9_999_999_999 })
        .filter((n) => n !== 100_000_000)
        .map((n) => decimal(n, 8)),
    }),
    fc.record({
      type: fc.constantFrom(
        "DEPOSIT" as const,
        "WITHDRAWAL" as const,
        "FEE" as const,
        "TAX" as const,
      ),
      instrument_id: fc.constant(null),
      quantity: fc.constant(null),
      price: fc.constant(null),
      fee: fc.constant("0.0000"),
      amount: positive(4),
      split_ratio: fc.constant(null),
    }),
    fc.record({
      type: fc.constant("INTEREST" as const),
      instrument_id: fc.constant(null),
      quantity: fc.constant(null),
      price: fc.constant(null),
      fee: fc.constant("0.0000"),
      // El interés de margen es negativo.
      amount: fc
        .tuple(fc.boolean(), positive(4))
        .map(([negative, value]) => (negative ? `-${value}` : value)),
      split_ratio: fc.constant(null),
    }),
  )
  .chain((rest) =>
    base.map((b): TransactionRow => ({
      id: "r",
      currency: "USD",
      source: "manual",
      external_id: null,
      created_at: "2026-09-24T10:00:00+00:00",
      seq: 1,
      ...rest,
      ...b,
    })),
  );

describe("ida y vuelta con libros aleatorios", () => {
  it("exportar e importar devuelve las mismas operaciones", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 30 }), (rows) => {
        // El export sale en el orden del libro: por fecha; el parser conserva ese orden.
        const ordered = [...rows].sort(
          (a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at),
        );
        const csv = buildTransactionsCsv(ordered, SYMBOL_IDS);
        const parsed = parseSimpleCsv(csv, NOW);

        expect(parsed.errors).toEqual([]);
        expect(parsed.fatal).toBeNull();
        expect(summarizeParsed(parsed)).toEqual(
          ordered.map((row) => summarizeRow(row, SYMBOL_IDS)),
        );
      }),
      { numRuns: 300 },
    );
  });
});
