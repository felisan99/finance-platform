import { describe, expect, it } from "vitest";
import { computeEngine } from "../engine";
import { d } from "../decimal";
import { missingSplits, type SplitEvent } from "../splits";
import type { Transaction } from "../types";
import { buy, deepFreeze, deposit, expectDec, sell, split } from "./helpers";

// Las 15:00Z son las 11:00 en Nueva York: cada operación cae en su día.
const at = (day: string) => `${day}T15:00:00Z`;
const event = (
  symbol: string,
  exDate: string,
  ratio: string,
  id = `${symbol}-${exDate}`,
): SplitEvent => ({ id, symbol, exDate, ratio: d(ratio) });

// El caso que lo motivó: 5 SOXX comprados antes del 3:1 del 2026-11-05.
const soxx: Transaction[] = [
  deposit(at("2026-05-01"), "10000"),
  buy(at("2026-05-12"), "SOXX", "1", "510.4"),
  buy(at("2026-06-23"), "SOXX", "1", "604.69"),
  buy(at("2026-08-28"), "SOXX", "1", "508.72"),
  buy(at("2026-10-23"), "SOXX", "1", "480.86"),
  buy(at("2026-10-30"), "SOXX", "1", "466.87"),
];
const SOXX_SPLIT = event("SOXX", "2026-11-05", "3");

const run = (
  transactions: readonly Transaction[] = soxx,
  events: SplitEvent[] = [SOXX_SPLIT],
  options: { today?: string; dismissed?: string[] } = {},
) =>
  missingSplits({
    transactions,
    events,
    dismissed: new Set(options.dismissed ?? []),
    today: options.today ?? "2026-11-06",
  });

describe("missingSplits", () => {
  it("propone el split a quien tenía el activo el día anterior, con su cantidad", () => {
    const [s] = run();
    expect(s).toMatchObject({
      eventId: "SOXX-2026-11-05",
      symbol: "SOXX",
      exDate: "2026-11-05",
    });
    expectDec(s!.ratio, "3");
    expectDec(s!.shares, "5");
  });

  it("solo cuenta lo que había al cierre del día anterior al ex-split", () => {
    const sameDay = [
      deposit(at("2026-05-01"), "10000"),
      buy(at("2026-11-05"), "SOXX", "3", "132"), // ya a precio nuevo: no lleva split
    ];
    expect(run(sameDay)).toEqual([]);
    const soldBefore = [...soxx, sell(at("2026-11-04"), "SOXX", "5", "450")];
    expect(run(soldBefore)).toEqual([]);
    const partly = [...soxx, sell(at("2026-11-04"), "SOXX", "2", "450")];
    expectDec(run(partly)[0]!.shares, "3");
  });

  it("no lo repite si ya hay un SPLIT del símbolo cerca de la fecha (a mano, con otra fecha u otra razón)", () => {
    // El que cargó Felipe: el mismo día, a la tarde.
    expect(run([...soxx, split("2026-11-05T21:50:00Z", "SOXX", "3")])).toEqual(
      [],
    );
    // Cargado unos días después, o con una razón mal escrita: igual cuenta como ese split.
    expect(run([...soxx, split(at("2026-11-12"), "SOXX", "3")])).toEqual([]);
    expect(run([...soxx, split(at("2026-11-05"), "SOXX", "2")])).toEqual([]);
    expect(run([...soxx, split(at("2026-10-30"), "SOXX", "3")])).toEqual([]);
    // Un split de otro símbolo, o del mismo pero de otra época, no.
    expect(run([...soxx, split(at("2026-11-05"), "NVDA", "3")])).toHaveLength(
      1,
    );
    const old = [
      deposit(at("2024-01-02"), "10000"),
      buy(at("2024-01-05"), "SOXX", "1", "600"),
      split(at("2024-03-07"), "SOXX", "3"),
    ];
    expect(run(old)).toHaveLength(1);
  });

  it("no vuelve a agregar uno que la persona borró", () => {
    expect(run(soxx, [SOXX_SPLIT], { dismissed: ["SOXX-2026-11-05"] })).toEqual(
      [],
    );
  });

  it("ignora splits futuros y razones inválidas", () => {
    expect(run(soxx, [SOXX_SPLIT], { today: "2026-11-04" })).toEqual([]);
    expect(run(soxx, [event("SOXX", "2026-11-05", "1")])).toEqual([]);
    expect(run(soxx, [event("SOXX", "2026-11-05", "0")])).toEqual([]);
  });

  it("encadena splits que faltan: cuenta la cantidad con los anteriores aplicados y los ordena", () => {
    const nvda = [
      deposit(at("2021-01-04"), "100000"),
      buy(at("2021-06-01"), "NVDA", "10", "650"),
    ];
    const events = [
      event("NVDA", "2024-06-10", "10"),
      event("NVDA", "2021-07-20", "4"),
    ];
    const found = run(nvda, events, { today: "2026-11-06" });
    expect(found.map((s) => s.exDate)).toEqual(["2021-07-20", "2024-06-10"]);
    expectDec(found[0]!.shares, "10");
    // Sin el de 2021 cargado el libro todavía tiene 10 el día antes del de 2024: la cantidad es
    // informativa; lo que importa es que había posición.
    expectDec(found[1]!.shares, "10");
  });

  it("un split inverso también se agrega", () => {
    const [s] = run(soxx, [event("SOXX", "2026-11-05", "0.1")]);
    expectDec(s!.ratio, "0.1");
  });

  it("con el split agregado, la posición queda bien valuada y el libro sin avisos nuevos", () => {
    const [s] = run();
    const withSplit = [
      ...soxx,
      split("2026-11-05T09:00:00Z", "SOXX", s!.ratio.toFixed()),
    ];
    const result = computeEngine(withSplit);
    const position = result.positions.find((p) => p.symbol === "SOXX")!;
    expectDec(position.quantity, "15");
    expect(result.issues).toEqual([]);
    expect(run(withSplit)).toEqual([]);
  });

  it("no muta la entrada", () => {
    const txs = deepFreeze([...soxx]);
    const events = deepFreeze([SOXX_SPLIT]);
    expect(() =>
      missingSplits({
        transactions: txs,
        events,
        dismissed: new Set(),
        today: "2026-11-06",
      }),
    ).not.toThrow();
  });
});
