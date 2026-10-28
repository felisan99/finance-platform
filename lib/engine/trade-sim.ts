import { QTY_EPSILON, ZERO, type Dec } from "./decimal";
import type { ValuedPortfolio } from "./valuation";

// "¿Cómo quedaría la cartera si…?": compras y ventas hipotéticas a los precios de hoy. Puro.
//
// Mismas reglas que la valuación (`valuePortfolio`): el peso de cada posición es su valor sobre el
// valor total (posiciones con precio + efectivo), y una posición sin precio no entra en el total.
// Las comisiones no se simulan. La ganancia de una venta se estima con el costo promedio de hoy
// (con «Todo junto», el promedio combinado de las cuentas).

export interface SimTrade {
  symbol: string;
  side: "BUY" | "SELL";
  /** Exactamente uno: cantidad, monto en dólares, o fracción de la posición (solo ventas, 0–1). */
  quantity?: Dec;
  amount?: Dec;
  fraction?: Dec;
}

export interface SimInput {
  valued: ValuedPortfolio;
  trades: readonly SimTrade[];
  /** Precio de hoy de cada símbolo que se opera (las posiciones abiertas ya traen el suyo). */
  prices: ReadonlyMap<string, Dec>;
  /** Las compras se pagan con el efectivo de la cuenta o con plata nueva (un depósito). */
  funding: "cash" | "new_money";
}

export interface SimTradeResult {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: Dec;
  price: Dec;
  /** Cantidad × precio. */
  amount: Dec;
  /** Solo ventas: `cantidad × (precio − costo promedio)`. */
  realizedGain: Dec | null;
}

export interface SimHolding {
  symbol: string;
  quantity: Dec;
  value: Dec;
  /** Sobre el valor total; `null` si el total no es positivo. */
  weight: Dec | null;
}

export interface SimState {
  totalValue: Dec;
  cash: Dec;
  cashWeight: Dec | null;
  /** Posiciones con precio, de mayor a menor valor (empate: por símbolo). */
  holdings: SimHolding[];
}

export type SimResult =
  | {
      ok: true;
      before: SimState;
      after: SimState;
      trades: SimTradeResult[];
      /** Plata nueva que habría que depositar (0 si se paga con efectivo). */
      newMoney: Dec;
      /** Posiciones abiertas sin precio: no entran en el total ni en los pesos. */
      unpriced: string[];
    }
  | { ok: false; error: string };

interface Holding {
  quantity: Dec;
  price: Dec;
  avgCost: Dec | null;
}

function state(holdings: ReadonlyMap<string, Holding>, cash: Dec): SimState {
  const rows = [...holdings.entries()]
    .filter(([, h]) => h.quantity.abs().gte(QTY_EPSILON))
    .map(([symbol, h]) => ({
      symbol,
      quantity: h.quantity,
      value: h.quantity.mul(h.price),
    }));
  const totalValue = rows
    .reduce((acc, r) => acc.plus(r.value), ZERO)
    .plus(cash);
  const weightOf = (value: Dec) =>
    totalValue.gt(0) ? value.div(totalValue) : null;
  return {
    totalValue,
    cash,
    cashWeight: weightOf(cash),
    holdings: rows
      .map((r) => ({ ...r, weight: weightOf(r.value) }))
      .sort(
        (a, b) => b.value.comparedTo(a.value) || (a.symbol < b.symbol ? -1 : 1),
      ),
  };
}

export function simulateTrades(input: SimInput): SimResult {
  const holdings = new Map<string, Holding>();
  for (const position of input.valued.positions) {
    if (!position.isOpen || position.price === null) continue;
    holdings.set(position.symbol, {
      quantity: position.quantity,
      price: position.price,
      avgCost: position.avgCost,
    });
  }
  const unpriced = input.valued.missingPrices;
  const before = state(holdings, input.valued.cash);

  if (input.trades.length === 0)
    return { ok: false, error: "No hay operaciones para simular." };

  let cash = input.valued.cash;
  let newMoney = ZERO;
  const results: SimTradeResult[] = [];

  for (const trade of input.trades) {
    const given = [trade.quantity, trade.amount, trade.fraction].filter(
      (v) => v !== undefined,
    );
    if (given.length !== 1) {
      return {
        ok: false,
        error: `${trade.symbol}: indicá cantidad, monto o fracción (uno solo).`,
      };
    }
    if (unpriced.includes(trade.symbol)) {
      return {
        ok: false,
        error: `${trade.symbol} no tiene precio: no se puede simular.`,
      };
    }
    const held = holdings.get(trade.symbol);
    const price = held?.price ?? input.prices.get(trade.symbol) ?? null;
    if (price === null || !price.gt(0)) {
      return { ok: false, error: `No tengo el precio de ${trade.symbol}.` };
    }

    let quantity: Dec;
    if (trade.fraction !== undefined) {
      if (trade.side !== "SELL") {
        return { ok: false, error: "Una fracción solo vale para ventas." };
      }
      if (!trade.fraction.gt(0) || trade.fraction.gt(1)) {
        return { ok: false, error: "La fracción tiene que estar entre 0 y 1." };
      }
      quantity = (held?.quantity ?? ZERO).mul(trade.fraction);
    } else if (trade.amount !== undefined) {
      if (!trade.amount.gt(0))
        return { ok: false, error: "El monto tiene que ser positivo." };
      quantity = trade.amount.div(price);
    } else {
      if (!trade.quantity!.gt(0))
        return { ok: false, error: "La cantidad tiene que ser positiva." };
      quantity = trade.quantity!;
    }

    const amount = quantity.mul(price);
    if (trade.side === "SELL") {
      const available = held?.quantity ?? ZERO;
      if (quantity.gt(available.plus(QTY_EPSILON))) {
        return {
          ok: false,
          error: `No alcanza la tenencia de ${trade.symbol} para esa venta.`,
        };
      }
      const remaining = available.minus(quantity).lt(QTY_EPSILON)
        ? ZERO
        : available.minus(quantity);
      holdings.set(trade.symbol, { ...held!, quantity: remaining });
      cash = cash.plus(amount);
      results.push({
        symbol: trade.symbol,
        side: "SELL",
        quantity,
        price,
        amount,
        realizedGain:
          held!.avgCost === null
            ? null
            : quantity.mul(price.minus(held!.avgCost)),
      });
    } else {
      if (input.funding === "cash") {
        if (amount.gt(cash)) {
          return {
            ok: false,
            error: `No alcanza el efectivo para comprar ${trade.symbol} (después de las ventas anteriores).`,
          };
        }
        cash = cash.minus(amount);
      } else {
        newMoney = newMoney.plus(amount);
      }
      holdings.set(trade.symbol, {
        quantity: (held?.quantity ?? ZERO).plus(quantity),
        price,
        avgCost: held?.avgCost ?? null,
      });
      results.push({
        symbol: trade.symbol,
        side: "BUY",
        quantity,
        price,
        amount,
        realizedGain: null,
      });
    }
  }

  return {
    ok: true,
    before,
    after: state(holdings, cash),
    trades: results,
    newMoney,
    unpriced,
  };
}
