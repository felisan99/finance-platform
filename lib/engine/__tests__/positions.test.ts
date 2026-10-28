import { describe, expect, it } from "vitest";
import { d } from "../decimal";
import {
  applyBuy,
  applyDividend,
  applySell,
  applySplit,
  emptyPosition,
  toPosition,
  type PositionState,
} from "../positions";
import { buy, expectDec, sell } from "./helpers";

const T = "2026-03-09T22:34:00Z";

function sold(
  state: PositionState,
  tx: ReturnType<typeof sell>,
): PositionState {
  const outcome = applySell(state, tx);
  if (!outcome.ok) throw new Error("La venta debería ser válida");
  return outcome.state;
}

describe("costo promedio (spec §6.1)", () => {
  it("BUY suma cantidad y costo (incluida la comisión)", () => {
    const p = applyBuy(emptyPosition, buy(T, "X", "10", "10", "1"));
    expectDec(p.quantity, "10");
    expectDec(p.costBasis, "101");
  });

  it("varias compras promedian el costo", () => {
    let p = applyBuy(emptyPosition, buy(T, "X", "10", "10", "1")); // costo 101
    p = applyBuy(p, buy(T, "X", "10", "20", "1")); // costo +201
    expectDec(p.quantity, "20");
    expectDec(p.costBasis, "302");
    expectDec(toPosition("X", p).avgCost!, "15.1");
  });

  it("venta parcial: vector calculado a mano", () => {
    // Compra 10 a 10 con comisión 1 -> costo base 101 (promedio 10.1).
    // Vende 4 a 12 con comisión 1 -> proceeds 47, costo consumido 40.4, realizado 6.6.
    const p = sold(
      applyBuy(emptyPosition, buy(T, "X", "10", "10", "1")),
      sell(T, "X", "4", "12", "1"),
    );
    expectDec(p.quantity, "6");
    expectDec(p.costBasis, "60.6");
    expectDec(p.realizedPnl, "6.6");
    expectDec(toPosition("X", p).avgCost!, "10.1"); // el promedio no cambia al vender
  });

  it("venta total: cierra en 0 exacto y conserva el realizado", () => {
    let p = applyBuy(emptyPosition, buy(T, "X", "10", "10", "1"));
    p = sold(p, sell(T, "X", "4", "12", "1")); // realizado 6.6
    p = sold(p, sell(T, "X", "6", "11", "1")); // proceeds 65, costo 60.6 -> +4.4
    expectDec(p.quantity, "0");
    expectDec(p.costBasis, "0");
    expectDec(p.realizedPnl, "11");
    const position = toPosition("X", p);
    expect(position.isOpen).toBe(false);
    expect(position.avgCost).toBeNull();
  });

  it("una venta total consume el costo exacto aunque el costo promedio sea periódico", () => {
    // Costo 100 repartido en 3 acciones: 33.333… por acción. Se vende 1 y después las 2 restantes.
    let p = applyBuy(
      emptyPosition,
      buy(T, "X", "3", "33.33333333", "0.00000001"),
    );
    p = sold(p, sell(T, "X", "1", "40"));
    p = sold(p, sell(T, "X", "2", "40"));
    expectDec(p.quantity, "0");
    expectDec(p.costBasis, "0");
    // Todo el costo (100) sale en algún momento: realizado = 120 − 100, sin residuo de división.
    expectDec(p.realizedPnl, "20");
  });

  it("vender más de lo que hay es un error y no cambia nada", () => {
    const p = applyBuy(emptyPosition, buy(T, "X", "10", "10"));
    const outcome = applySell(p, sell(T, "X", "11", "10"));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expectDec(outcome.requested, "11");
      expectDec(outcome.available, "10");
    }
  });

  it("vender de una posición vacía es un error", () => {
    expect(applySell(emptyPosition, sell(T, "X", "1", "10")).ok).toBe(false);
  });

  it("tolerancia de 1e-9: el polvo restante cierra la posición", () => {
    const p = applyBuy(emptyPosition, buy(T, "X", "1", "100"));
    const closed = sold(p, sell(T, "X", "0.9999999995", "100")); // quedan 5e-10 < ε
    expectDec(closed.quantity, "0");
    expectDec(closed.costBasis, "0");
    expectDec(closed.realizedPnl, "-0.00000005"); // 99.99999995 − 100
  });

  it("tolerancia de 1e-9: vender apenas de más (dentro de ε) cierra sin error", () => {
    const p = applyBuy(emptyPosition, buy(T, "X", "1", "100"));
    const closed = sold(p, sell(T, "X", "1.0000000005", "100"));
    expectDec(closed.quantity, "0");
  });

  it("vender más allá de la tolerancia sigue siendo un error", () => {
    const p = applyBuy(emptyPosition, buy(T, "X", "1", "100"));
    expect(applySell(p, sell(T, "X", "1.000000002", "100")).ok).toBe(false);
  });

  it("las cantidades fraccionarias suman exactas (sin error de float)", () => {
    let p = applyBuy(emptyPosition, buy(T, "VOO", "0.4", "655.2", "1"));
    p = applyBuy(p, buy(T, "VOO", "1.2", "661.1", "1"));
    p = applyBuy(p, buy(T, "VOO", "0.35", "677", "1"));
    expectDec(p.quantity, "1.95");
  });

  it("recomprar tras cerrar reabre sobre el mismo realizado", () => {
    let p = applyBuy(emptyPosition, buy(T, "X", "5", "10"));
    p = sold(p, sell(T, "X", "5", "12")); // realizado 10
    p = applyBuy(p, buy(T, "X", "5", "20"));
    expectDec(p.quantity, "5");
    expectDec(p.costBasis, "100");
    expectDec(p.realizedPnl, "10");
    expect(toPosition("X", p).isOpen).toBe(true);
  });

  it("SPLIT multiplica la cantidad y no toca el costo base", () => {
    const p = applyBuy(emptyPosition, buy(T, "NVDA", "10", "100")); // costo 1000
    const forward = applySplit(p, d("10")); // 10:1
    expectDec(forward.quantity, "100");
    expectDec(forward.costBasis, "1000");
    expectDec(toPosition("NVDA", forward).avgCost!, "10");

    const reverse = applySplit(p, d("0.1")); // 1:10 inverso
    expectDec(reverse.quantity, "1");
    expectDec(reverse.costBasis, "1000");
    expectDec(toPosition("NVDA", reverse).avgCost!, "1000");
  });

  it("DIVIDEND acumula sin tocar cantidad ni costo", () => {
    let p = applyBuy(emptyPosition, buy(T, "VOO", "2", "100"));
    p = applyDividend(applyDividend(p, d("1.25")), d("0.5"));
    expectDec(p.dividends, "1.75");
    expectDec(p.quantity, "2");
    expectDec(p.costBasis, "200");
  });

  it("no muta el estado recibido", () => {
    const before = { ...emptyPosition };
    applyBuy(emptyPosition, buy(T, "X", "10", "10"));
    expect(emptyPosition).toEqual(before);
  });
});
