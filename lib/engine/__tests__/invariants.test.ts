import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ZERO, computeEngine, d, type Dec, type Transaction } from "../index";
import { ACCOUNT, snapshot } from "./helpers";

// Pruebas de propiedades: historiales aleatorios pero válidos, contrastados contra un
// modelo independiente (que lleva el costo promedio con otra aritmética: divide en cada
// compra en vez de acumular el costo base) y contra la ley de conservación del capital.

const SYMBOLS = ["AAA", "BBB", "CCC", "DDD"] as const;
const RATIOS = ["2", "3", "0.5"] as const;
const TOLERANCE = d("1e-20");

type Command =
  | {
      kind: "deposit" | "withdrawal" | "fee" | "tax" | "interest";
      cents: number;
    }
  | { kind: "dividend"; symbol: number; cents: number }
  | {
      kind: "buy";
      symbol: number;
      milliShares: number;
      priceCents: number;
      feeCents: number;
    }
  | {
      kind: "sell";
      symbol: number;
      percent: number;
      priceCents: number;
      feeCents: number;
    }
  | { kind: "split"; symbol: number; ratio: number };

const symbol = fc.integer({ min: 0, max: SYMBOLS.length - 1 });
const positiveCents = fc.integer({ min: 1, max: 5_000_000 });

const command: fc.Arbitrary<Command> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("deposit" as const),
      cents: positiveCents,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constantFrom(
        "withdrawal" as const,
        "fee" as const,
        "tax" as const,
      ),
      cents: positiveCents,
    }),
  },
  {
    weight: 1,
    // El interés puede ser negativo (interés de margen).
    arbitrary: fc.record({
      kind: fc.constant("interest" as const),
      cents: fc.integer({ min: -10_000, max: 10_000 }).filter((n) => n !== 0),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("dividend" as const),
      symbol,
      cents: positiveCents,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("buy" as const),
      symbol,
      milliShares: fc.integer({ min: 1, max: 100_000 }),
      priceCents: fc.integer({ min: 0, max: 1_000_000 }),
      feeCents: fc.integer({ min: 0, max: 500 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("sell" as const),
      symbol,
      percent: fc.integer({ min: 1, max: 100 }),
      priceCents: fc.integer({ min: 0, max: 1_000_000 }),
      feeCents: fc.integer({ min: 0, max: 500 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("split" as const),
      symbol,
      ratio: fc.integer({ min: 0, max: RATIOS.length - 1 }),
    }),
  },
);

interface ModelPosition {
  qty: Dec;
  avg: Dec;
  realized: Dec;
  dividends: Dec;
}

const cents = (n: number): Dec => d(String(n)).div(100);

/** Traduce los comandos a transacciones válidas y, en paralelo, calcula el resultado esperado. */
function interpret(commands: Command[]) {
  const txs: Transaction[] = [];
  const model = new Map<string, ModelPosition>();
  const totals = {
    deposits: ZERO,
    withdrawals: ZERO,
    interest: ZERO,
    fees: ZERO,
    taxes: ZERO,
  };
  let cash = ZERO;
  let counter = 0;
  const base = Date.UTC(2026, 0, 1);

  const next = () => {
    const at = new Date(base + counter * 60_000); // un minuto entre operaciones: orden sin empates
    return {
      id: `p${counter++}`,
      accountId: ACCOUNT,
      currency: "USD",
      executedAt: at,
      createdAt: at,
    };
  };
  const positionFor = (name: string): ModelPosition =>
    model.get(name) ?? {
      qty: ZERO,
      avg: ZERO,
      realized: ZERO,
      dividends: ZERO,
    };

  for (const c of commands) {
    switch (c.kind) {
      case "deposit":
      case "withdrawal":
      case "fee":
      case "tax":
      case "interest": {
        const amount = cents(c.cents);
        const type = {
          deposit: "DEPOSIT",
          withdrawal: "WITHDRAWAL",
          fee: "FEE",
          tax: "TAX",
          interest: "INTEREST",
        }[c.kind] as "DEPOSIT" | "WITHDRAWAL" | "FEE" | "TAX" | "INTEREST";
        txs.push({ ...next(), type, symbol: null, amount });
        if (c.kind === "deposit") {
          cash = cash.plus(amount);
          totals.deposits = totals.deposits.plus(amount);
        } else if (c.kind === "interest") {
          cash = cash.plus(amount);
          totals.interest = totals.interest.plus(amount);
        } else {
          cash = cash.minus(amount);
          if (c.kind === "withdrawal")
            totals.withdrawals = totals.withdrawals.plus(amount);
          if (c.kind === "fee") totals.fees = totals.fees.plus(amount);
          if (c.kind === "tax") totals.taxes = totals.taxes.plus(amount);
        }
        break;
      }
      case "dividend": {
        const name = SYMBOLS[c.symbol]!;
        const amount = cents(c.cents);
        txs.push({ ...next(), type: "DIVIDEND", symbol: name, amount });
        const p = positionFor(name);
        model.set(name, { ...p, dividends: p.dividends.plus(amount) });
        cash = cash.plus(amount);
        break;
      }
      case "buy": {
        const name = SYMBOLS[c.symbol]!;
        const quantity = d(String(c.milliShares)).div(1000);
        const price = cents(c.priceCents);
        const fee = cents(c.feeCents);
        txs.push({
          ...next(),
          type: "BUY",
          symbol: name,
          quantity,
          price,
          fee,
        });
        const p = positionFor(name);
        const qty = p.qty.plus(quantity);
        // promedio nuevo = (costo previo + costo de la compra) / cantidad nueva
        const avg = p.qty
          .mul(p.avg)
          .plus(quantity.mul(price))
          .plus(fee)
          .div(qty);
        model.set(name, { ...p, qty, avg });
        cash = cash.minus(quantity.mul(price).plus(fee));
        break;
      }
      case "sell": {
        const name = SYMBOLS[c.symbol]!;
        const p = positionFor(name);
        if (p.qty.isZero()) break; // no hay nada que vender
        let quantity = p.qty.mul(c.percent).div(100); // exacto: percent es un entero
        // Evita generar "polvo" (< 1e-6): la regla de tolerancia ε se prueba aparte, en positions.test.ts.
        if (p.qty.minus(quantity).lt("0.000001")) quantity = p.qty;
        const price = cents(c.priceCents);
        const fee = cents(c.feeCents);
        txs.push({
          ...next(),
          type: "SELL",
          symbol: name,
          quantity,
          price,
          fee,
        });
        const proceeds = quantity.mul(price).minus(fee);
        const qty = p.qty.minus(quantity);
        model.set(name, {
          ...p,
          qty,
          avg: qty.isZero() ? ZERO : p.avg,
          realized: p.realized.plus(proceeds).minus(quantity.mul(p.avg)),
        });
        cash = cash.plus(proceeds);
        break;
      }
      case "split": {
        const name = SYMBOLS[c.symbol]!;
        const p = positionFor(name);
        const ratio = d(RATIOS[c.ratio]!);
        // Sin posición no hay split que aplicar; y evita cantidades ridículamente chicas.
        if (p.qty.isZero() || p.qty.mul(ratio).lt("0.0001")) break;
        txs.push({ ...next(), type: "SPLIT", symbol: name, splitRatio: ratio });
        model.set(name, { ...p, qty: p.qty.mul(ratio), avg: p.avg.div(ratio) });
        break;
      }
    }
  }
  return { txs, model, cash, totals };
}

/** Barajado determinista (mulberry32) para que fast-check pueda reproducir y reducir fallos. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const near = (actual: Dec, expected: Dec) => {
  expect(
    actual.minus(expected).abs().lte(TOLERANCE),
    `${actual.toFixed()} ≈ ${expected.toFixed()}`,
  ).toBe(true);
};

describe("propiedades del motor", () => {
  const histories = fc.array(command, { minLength: 1, maxLength: 40 });

  it("coincide con el modelo independiente (cantidades, dividendos, realizado, costo y efectivo)", () => {
    fc.assert(
      fc.property(histories, (commands) => {
        const { txs, model, cash } = interpret(commands);
        const result = computeEngine(txs);

        expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
        expect(result.cash.toFixed()).toBe(cash.toFixed()); // el efectivo es exacto

        for (const position of result.positions) {
          const expected = model.get(position.symbol)!;
          expect(position.quantity.toFixed()).toBe(expected.qty.toFixed());
          expect(position.dividends.toFixed()).toBe(
            expected.dividends.toFixed(),
          );
          near(position.realizedPnl, expected.realized);
          near(position.costBasis, expected.qty.mul(expected.avg));
        }
        // No aparece ni falta ningún símbolo.
        expect(result.positions.map((p) => p.symbol).sort()).toEqual(
          [...model.keys()].sort(),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("conserva el capital: depósitos − retiros + resultados = efectivo + costo abierto", () => {
    fc.assert(
      fc.property(histories, (commands) => {
        const { txs } = interpret(commands);
        const { totals, cash } = computeEngine(txs);
        const lhs = totals.deposits
          .minus(totals.withdrawals)
          .plus(totals.realizedPnl)
          .plus(totals.dividends)
          .plus(totals.interest)
          .minus(totals.fees)
          .minus(totals.taxes);
        near(lhs, cash.plus(totals.openCostBasis));
      }),
      { numRuns: 300 },
    );
  });

  it("nunca deja cantidades negativas y las posiciones cerradas quedan en 0 exacto", () => {
    fc.assert(
      fc.property(histories, (commands) => {
        const { positions } = computeEngine(interpret(commands).txs);
        for (const p of positions) {
          expect(p.quantity.gte(0)).toBe(true);
          expect(p.isOpen).toBe(!p.quantity.isZero());
          if (!p.isOpen) {
            expect(p.costBasis.isZero()).toBe(true);
            expect(p.avgCost).toBeNull();
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("el resultado no depende del orden en que llegan las transacciones", () => {
    fc.assert(
      fc.property(histories, fc.integer(), (commands, seed) => {
        const { txs } = interpret(commands);
        expect(snapshot(computeEngine(shuffled(txs, seed)))).toEqual(
          snapshot(computeEngine(txs)),
        );
      }),
      { numRuns: 300 },
    );
  });
});
