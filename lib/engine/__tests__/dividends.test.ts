import { describe, expect, it } from "vitest";
import { d } from "../decimal";
import { suggestDividends, type DividendEvent } from "../dividends";
import type { Transaction } from "../types";
import {
  buy,
  deepFreeze,
  deposit,
  dividend,
  expectDec,
  sell,
  split,
} from "./helpers";

// Las 15:00Z son las 11:00 en Nueva York: cada operación cae en su día.
const at = (day: string) => `${day}T15:00:00Z`;
const event = (
  symbol: string,
  exDate: string,
  amount: string,
  id = `${symbol}-${exDate}`,
): DividendEvent => ({
  id,
  symbol,
  exDate,
  amount: d(amount),
});
const base: Transaction[] = [
  deposit(at("2026-01-02"), "100000"),
  buy(at("2026-01-05"), "KO", "100", "60"),
];
const run = (
  transactions: Transaction[] = base,
  events: DividendEvent[] = [event("KO", "2026-03-13", "0.51")],
  rate = "0.3",
) =>
  suggestDividends({
    transactions,
    events,
    withholdingRate: d(rate),
    today: "2026-09-30",
  });

describe("suggestDividends", () => {
  it("propone bruto, retención del 30 % y neto, al centavo", () => {
    const [s] = run();
    expectDec(s!.shares, "100");
    expectDec(s!.gross, "51");
    expectDec(s!.withholding, "15.3");
    expectDec(s!.net, "35.7");
  });

  it("redondea al centavo como un broker", () => {
    const [s] = run(base, [event("KO", "2026-03-13", "0.515")], "0.3");
    expectDec(s!.gross, "51.5");
    const [odd] = run(
      [
        deposit(at("2026-01-02"), "1000"),
        buy(at("2026-01-05"), "KO", "3", "60"),
      ],
      [event("KO", "2026-03-13", "0.1235")],
    );
    expectDec(odd!.gross, "0.37"); // 0,3705
    expectDec(odd!.withholding, "0.11"); // 0,111
    expectDec(odd!.net, "0.26");
  });

  it("cuenta las acciones del día anterior al ex-dividendo", () => {
    const txs = [
      ...base,
      buy(at("2026-03-12"), "KO", "50", "60"), // el día anterior: cobra
      buy(at("2026-03-13"), "KO", "25", "60"), // el mismo día del ex: no cobra
      sell(at("2026-03-16"), "KO", "175", "60"), // después: no importa
    ];
    const [s] = run(txs);
    expectDec(s!.shares, "150");
  });

  it("sin tenencia ese día no propone nada", () => {
    expect(run(base, [event("KO", "2026-01-02", "0.51")])).toEqual([]);
    expect(run(base, [event("VOO", "2026-03-13", "1.8")])).toEqual([]);
    const closed = [...base, sell(at("2026-02-02"), "KO", "100", "60")];
    expect(run(closed)).toEqual([]);
  });

  it("des-ajusta el monto por acción con los splits posteriores del libro", () => {
    // 10 NVDA antes de un split 4:1; el proveedor da el dividendo ajustado (0,01 en vez de 0,04).
    const txs = [
      deposit(at("2026-01-02"), "100000"),
      buy(at("2026-01-05"), "NVDA", "10", "500"),
      split(at("2026-06-10"), "NVDA", "4"),
    ];
    const [before] = run(txs, [event("NVDA", "2026-03-11", "0.01")]);
    expectDec(before!.shares, "10");
    expectDec(before!.perShare, "0.04");
    expectDec(before!.gross, "0.4");
    const [after] = run(txs, [event("NVDA", "2026-09-10", "0.01")]);
    expectDec(after!.shares, "40");
    expectDec(after!.perShare, "0.01");
  });

  it("no repite uno que ya está cargado cerca de la fecha (a mano, importado o confirmado)", () => {
    const withPaid = [...base, dividend(at("2026-04-01"), "KO", "35.70")];
    expect(run(withPaid)).toEqual([]);
    // Un dividendo cargado lejos de esa fecha es otro: se propone igual.
    const other = [...base, dividend(at("2026-08-01"), "KO", "30")];
    expect(run(other)).toHaveLength(1);
  });

  it("no propone ex-dividendos futuros y ordena del más reciente al más viejo", () => {
    const events = [
      event("KO", "2026-03-13", "0.51"),
      event("KO", "2026-06-12", "0.51"),
      event("KO", "2026-12-11", "0.51"),
    ];
    expect(run(base, events).map((s) => s.exDate)).toEqual([
      "2026-06-12",
      "2026-03-13",
    ]);
  });

  it("con retención 0 el neto es el bruto; rechaza tasas fuera de rango", () => {
    const [s] = run(base, undefined, "0");
    expectDec(s!.withholding, "0");
    expectDec(s!.net, "51");
    expect(() => run(base, undefined, "1.5")).toThrow();
  });

  it("no muta la entrada", () => {
    const txs = deepFreeze([...base]);
    const events = deepFreeze([event("KO", "2026-03-13", "0.51")]);
    expect(() =>
      suggestDividends({
        transactions: txs,
        events,
        withholdingRate: d("0.3"),
        today: "2026-09-30",
      }),
    ).not.toThrow();
  });
});
