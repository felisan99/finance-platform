import {
  addDays,
  d,
  marketDay,
  simulateTrades,
  type Dec,
  type SimState,
  type SimTrade,
} from "@/lib/engine";
import {
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "@/lib/portfolio/format";
import type { AssistantDataSource } from "../data-source";
import type { ToolResult } from "../tool-result";
import { checkSymbol, fail, ok } from "./shared";

export const MAX_SIM_TRADES = 5;
/** Días hacia atrás para buscar el último cierre de un símbolo que no está en la cartera. */
const PRICE_LOOKBACK_DAYS = 14;
/** Posiciones que se listan además de las que se operan. */
const TOP_HOLDINGS = 6;

export const TRADE_MEASURES = ["acciones", "dolares", "fraccion"] as const;

export interface SimulateTradeInput {
  operaciones: Array<{
    simbolo: string;
    lado: "comprar" | "vender";
    /** Cómo se expresa `valor`: cantidad de unidades, monto en dólares o fracción de la posición. */
    medida: (typeof TRADE_MEASURES)[number];
    valor: number;
  }>;
  fondeo?: "efectivo" | "plata_nueva";
}

// Los `number` del modelo pasan a decimal por texto, con un tope de dígitos (como los formularios).
const toDec = (value: number): Dec | null =>
  Number.isFinite(value) ? d(value.toFixed(8)) : null;

/**
 * Cómo quedaría la cartera después de comprar o vender, a los precios de hoy: pesos, efectivo y
 * total antes y después, y la ganancia que se realizaría. Así el modelo puede cuantificar una
 * recomendación sin hacer cuentas.
 */
export async function simulateTrade(
  ds: AssistantDataSource,
  input: SimulateTradeInput,
): Promise<ToolResult> {
  if (
    input.operaciones.length === 0 ||
    input.operaciones.length > MAX_SIM_TRADES
  ) {
    return fail(`Indicá entre 1 y ${MAX_SIM_TRADES} operaciones.`);
  }
  const trades: SimTrade[] = [];
  for (const op of input.operaciones) {
    const symbol = checkSymbol(op.simbolo);
    if (!symbol.ok) return fail(symbol.error);
    const value = toDec(op.valor);
    if (value === null)
      return fail(`${symbol.symbol}: el valor no es un número.`);
    trades.push({
      symbol: symbol.symbol,
      side: op.lado === "vender" ? "SELL" : "BUY",
      ...(op.medida === "acciones"
        ? { quantity: value }
        : op.medida === "dolares"
          ? { amount: value }
          : { fraction: value }),
    });
  }

  const snapshot = await ds.snapshot();
  const held = new Set(
    snapshot.valued.positions.filter((p) => p.isOpen).map((p) => p.symbol),
  );
  // El precio de lo que no está en la cartera: su último cierre conocido.
  const today = marketDay(ds.now);
  const prices = new Map<string, Dec>();
  for (const trade of trades) {
    if (held.has(trade.symbol) || prices.has(trade.symbol)) continue;
    const history = await ds.priceHistory(
      trade.symbol,
      addDays(today, -PRICE_LOOKBACK_DAYS),
    );
    const last = history?.closes.at(-1);
    if (last) prices.set(trade.symbol, last.close);
  }

  const result = simulateTrades({
    valued: snapshot.valued,
    trades,
    prices,
    funding: input.fondeo === "plata_nueva" ? "new_money" : "cash",
  });
  if (!result.ok) return fail(result.error);

  const traded = new Set(trades.map((t) => t.symbol));
  const show = (state: SimState) => {
    const rows = state.holdings.filter(
      (h, index) => index < TOP_HOLDINGS || traded.has(h.symbol),
    );
    return {
      valor_total: formatMoney(state.totalValue),
      efectivo: formatMoney(state.cash),
      peso_efectivo: formatPercent(state.cashWeight),
      posiciones: rows.map((h) => ({
        simbolo: h.symbol,
        cantidad: formatQuantity(h.quantity),
        valor: formatMoney(h.value),
        peso: formatPercent(h.weight),
      })),
    };
  };
  const weightIn = (state: SimState, symbol: string) =>
    formatPercent(
      state.holdings.find((h) => h.symbol === symbol)?.weight ?? d("0"),
    );

  return ok(
    {
      fn: "simulateTrades",
      detail: `precios de hoy · ${input.fondeo === "plata_nueva" ? "con plata nueva" : "con el efectivo"}`,
    },
    {
      portafolio: ds.scopeName,
      operaciones: result.trades.map((t) => ({
        simbolo: t.symbol,
        lado: t.side === "SELL" ? "venta" : "compra",
        cantidad: formatQuantity(t.quantity),
        precio: formatPrice(t.price, { currency: true }),
        monto: formatMoney(t.amount),
        ganancia_realizada_estimada:
          t.realizedGain === null
            ? null
            : formatMoney(t.realizedGain, { signed: true }),
        peso_antes: weightIn(result.before, t.symbol),
        peso_despues: weightIn(result.after, t.symbol),
      })),
      plata_nueva_a_depositar: result.newMoney.isZero()
        ? null
        : formatMoney(result.newMoney),
      antes: show(result.before),
      despues: show(result.after),
    },
    {
      missing: result.unpriced.map(
        (symbol) =>
          `Sin precio para ${symbol}: no entra en el total ni en los pesos.`,
      ),
      notes: [
        "Simulación a los precios de hoy, sin comisiones ni impuestos. La ganancia de una venta se estima con el costo promedio actual.",
      ],
    },
  );
}
