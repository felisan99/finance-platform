import { describe, expect, it } from "vitest";
import { d } from "@/lib/engine";
import { MOVERS_MAX, STALE_DAYS, buildMoversView } from "../movers-view";
import type { WatchlistRowView } from "../watchlist";

const NOW = new Date("2026-09-30T18:00:00.000Z");
const FRESH = new Date("2026-09-30T17:00:00.000Z");

/** Una fila de la watchlist con lo que mira la sección: símbolo, cambio del día y fecha del precio. */
const row = (
  symbol: string,
  pct: string | null,
  asOf: Date | null = FRESH,
): WatchlistRowView => ({
  instrumentId: `id-${symbol}`,
  symbol,
  name: null,
  typeLabel: null,
  price: asOf === null ? null : d("100"),
  priceSource: asOf === null ? null : "quote",
  priceAsOf: asOf,
  dayChange: null,
  dayChangePct: pct === null ? null : d(pct),
  range: null,
  spark: [],
});

const symbols = (movers: { symbol: string }[]) => movers.map((m) => m.symbol);

describe("buildMoversView", () => {
  it("ordena las subas de mayor a menor y las bajas de la que más bajó a la que menos", () => {
    const view = buildMoversView(
      [
        row("AAA", "0.01"),
        row("BBB", "-0.03"),
        row("CCC", "0.05"),
        row("DDD", "-0.01"),
        row("EEE", "0.02"),
      ],
      NOW,
    );
    expect(symbols(view!.gainers)).toEqual(["CCC", "EEE", "AAA"]);
    expect(symbols(view!.losers)).toEqual(["BBB", "DDD"]);
    expect(view!.gainers.every((m) => m.tone === "gain")).toBe(true);
    expect(view!.losers.every((m) => m.tone === "loss")).toBe(true);
  });

  it(`corta en ${MOVERS_MAX} por tarjeta`, () => {
    const rows = ["A", "B", "C", "D", "E", "F", "G"].map((s, i) =>
      row(s, `0.0${i + 1}`),
    );
    const view = buildMoversView(rows, NOW);
    expect(symbols(view!.gainers)).toEqual(["G", "F", "E", "D", "C"]);
    expect(view!.losers).toEqual([]);
  });

  it("los empates se ordenan por símbolo", () => {
    const view = buildMoversView(
      [
        row("ZZZ", "0.02"),
        row("AAA", "0.02"),
        row("MMM", "-0.02"),
        row("BBB", "-0.02"),
      ],
      NOW,
    );
    expect(symbols(view!.gainers)).toEqual(["AAA", "ZZZ"]);
    expect(symbols(view!.losers)).toEqual(["BBB", "MMM"]);
  });

  it("deja afuera lo que no tiene cambio, no tiene precio o redondea a 0,00 %", () => {
    const view = buildMoversView(
      [
        row("AAA", "0.03"),
        row("BBB", "-0.02"),
        row("NUL", null),
        row("SIN", "0.04", null),
        row("CER", "0.00004"),
        row("NEG", "-0.00004"),
      ],
      NOW,
    );
    expect(symbols(view!.gainers)).toEqual(["AAA"]);
    expect(symbols(view!.losers)).toEqual(["BBB"]);
  });

  it(`un precio de más de ${STALE_DAYS} días no es del día; justo en el límite sí`, () => {
    const limit = new Date(NOW.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);
    const older = new Date(limit.getTime() - 1);
    const view = buildMoversView(
      [
        row("LIM", "0.02", limit),
        row("OLD", "0.09", older),
        row("NEW", "0.01"),
      ],
      NOW,
    );
    expect(symbols(view!.gainers)).toEqual(["LIM", "NEW"]);
  });

  it("el alto es relativo a la mayor de cada tarjeta y nunca negativo", () => {
    const view = buildMoversView(
      [
        row("AAA", "0.04"),
        row("BBB", "0.01"),
        row("CCC", "-0.02"),
        row("DDD", "-0.005"),
      ],
      NOW,
    );
    expect(view!.gainers.map((m) => m.ratio)).toEqual([1, 0.25]);
    expect(view!.losers.map((m) => m.ratio)).toEqual([1, 0.25]);
  });

  it("formatea el porcentaje con signo y arma el enlace a la ficha", () => {
    const view = buildMoversView(
      [row("MP", "0.0571"), row("BRK.B", "-0.021")],
      NOW,
    );
    expect(view!.gainers[0]).toMatchObject({
      text: "+5,71%",
      href: "/positions/MP",
    });
    expect(view!.losers[0]).toMatchObject({
      text: "-2,10%",
      href: "/positions/BRK.B",
    });
  });

  it("con menos de dos símbolos con cambio no hay sección", () => {
    expect(buildMoversView([], NOW)).toBeNull();
    expect(buildMoversView([row("AAA", "0.03")], NOW)).toBeNull();
    expect(
      buildMoversView([row("AAA", "0.03"), row("BBB", null)], NOW),
    ).toBeNull();
  });

  it("con solo subas, la tarjeta de bajas queda vacía", () => {
    const view = buildMoversView([row("AAA", "0.03"), row("BBB", "0.01")], NOW);
    expect(view!.losers).toEqual([]);
    expect(symbols(view!.gainers)).toEqual(["AAA", "BBB"]);
  });
});
