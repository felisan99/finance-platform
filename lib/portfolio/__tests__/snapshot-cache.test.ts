import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeEngine, d, valuePortfolio, type PriceInfo } from "@/lib/engine";
import { buy, deposit, sell } from "@/lib/engine/__tests__/helpers";
import {
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_MAX_POSITIONS,
  SNAPSHOT_VERSION,
  buildCachedSnapshot,
} from "../snapshot-cache";
import { SNAPSHOT_KEY } from "../snapshot-storage";

const T = "2026-01-05T15:00:00Z";
const NOW = new Date("2026-09-24T18:30:00Z");

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string | null) => value?.replace(/[  ]/g, " ");

const quote = (price: string, previousClose: string | null): PriceInfo => ({
  price: d(price),
  asOf: new Date("2026-09-24T17:00:00Z"),
  source: "quote",
  previousClose: previousClose === null ? null : d(previousClose),
});

describe("buildCachedSnapshot", () => {
  // 5000 depositados; VOO 10 a 100 y AAA 4 a 50 => efectivo 3800; a 120 y 60 valen 1200 y 240 => total 5240.
  // Cambio del día: VOO 10 × (120 − 118) = +20; AAA 4 × (60 − 61) = −4 => +16 (16 / (5240 − 16)).
  const valued = valuePortfolio(
    computeEngine([
      deposit(T, "5000"),
      buy(T, "VOO", "10", "100"),
      buy(T, "AAA", "4", "50"),
    ]),
    new Map([
      ["VOO", quote("120", "118")],
      ["AAA", quote("60", "61")],
    ]),
  );

  it("textos ya formateados: total, cambio del día con signo, efectivo y posiciones por valor", () => {
    const snapshot = buildCachedSnapshot(valued, NOW);
    expect(snapshot).toMatchObject({
      version: 1,
      savedAt: "2026-09-24T18:30:00.000Z",
      tone: "gain",
    });
    expect(plain(snapshot.totalValue)).toBe("US$ 5.240,00");
    expect(plain(snapshot.dayChange)).toBe("+US$ 16,00");
    expect(snapshot.dayChangePct).toBe("+0,31%");
    expect(plain(snapshot.cash)).toBe("US$ 3.800,00");
    expect(snapshot.positions.map((p) => [p.symbol, plain(p.value)])).toEqual([
      ["VOO", "US$ 1.200,00"],
      ["AAA", "US$ 240,00"],
    ]);
  });

  it("una baja del día marca la pérdida", () => {
    const down = valuePortfolio(
      computeEngine([deposit(T, "1000"), buy(T, "VOO", "10", "100")]),
      new Map([["VOO", quote("90", "100")]]),
    );
    const snapshot = buildCachedSnapshot(down, NOW);
    expect(snapshot.tone).toBe("loss");
    expect(plain(snapshot.dayChange)).toBe("-US$ 100,00");
  });

  it("sin cierre anterior no hay cambio del día ni tono", () => {
    const flat = valuePortfolio(
      computeEngine([deposit(T, "1000"), buy(T, "VOO", "10", "100")]),
      new Map([["VOO", quote("110", null)]]),
    );
    const snapshot = buildCachedSnapshot(flat, NOW);
    expect(snapshot.dayChange).toBeNull();
    expect(snapshot.dayChangePct).toBeNull();
    expect(snapshot.tone).toBeNull();
    expect(plain(snapshot.totalValue)).toBe("US$ 1.100,00");
  });

  it("una posición sin precio no aparece; una cerrada tampoco", () => {
    const partial = valuePortfolio(
      computeEngine([
        deposit(T, "5000"),
        buy(T, "VOO", "10", "100"),
        buy(T, "NOPRICE", "1", "10"),
        buy(T, "CLOSED", "2", "10"),
        sell("2026-02-05T15:00:00Z", "CLOSED", "2", "12"),
      ]),
      new Map([
        ["VOO", quote("120", "118")],
        ["CLOSED", quote("15", "14")],
      ]),
    );
    expect(
      buildCachedSnapshot(partial, NOW).positions.map((p) => p.symbol),
    ).toEqual(["VOO"]);
  });

  it(`se queda con las ${SNAPSHOT_MAX_POSITIONS} de mayor valor, y a igual valor ordena por símbolo`, () => {
    const symbols = ["H", "G", "F", "E", "D", "C", "B", "A"];
    const many = valuePortfolio(
      computeEngine([
        deposit(T, "100000"),
        ...symbols.map((s) => buy(T, s, "1", "100")),
      ]),
      new Map(symbols.map((s) => [s, quote("100", "100")])),
    );
    // Todas valen 100: desempata el símbolo, A..F.
    expect(
      buildCachedSnapshot(many, NOW).positions.map((p) => p.symbol),
    ).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("con varios portafolios guarda de cuál es; con uno solo, nada", () => {
    expect(buildCachedSnapshot(valued, NOW).portfolioName).toBeNull();
    expect(buildCachedSnapshot(valued, NOW, "Cripto").portfolioName).toBe(
      "Cripto",
    );
  });

  it("no guarda nada más que lo que muestra la pantalla sin conexión", () => {
    const snapshot = buildCachedSnapshot(valued, NOW);
    expect(Object.keys(snapshot).sort()).toEqual([
      "cash",
      "dayChange",
      "dayChangePct",
      "portfolioName",
      "positions",
      "savedAt",
      "tone",
      "totalValue",
      "version",
    ]);
    for (const position of snapshot.positions) {
      expect(Object.keys(position).sort()).toEqual(["symbol", "value"]);
    }
    // Sobrevive a JSON (es lo que va al localStorage).
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe("contrato con la pantalla sin conexión (public/pwa/offline.js)", () => {
  const source = readFileSync(
    resolve(process.cwd(), "public/pwa/offline.js"),
    "utf8",
  );

  it("usa la misma clave, versión y vencimiento que el que guarda", () => {
    expect(source).toContain(`"${SNAPSHOT_KEY}"`);
    expect(source).toContain(`data.version !== ${SNAPSHOT_VERSION}`);
    expect(source).toContain("30 * 24 * 60 * 60 * 1000");
    expect(SNAPSHOT_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("lee todos los campos que se guardan", () => {
    for (const field of [
      "totalValue",
      "dayChange",
      "dayChangePct",
      "cash",
      "positions",
      "savedAt",
      "tone",
      "portfolioName",
    ]) {
      expect(source, field).toContain(`data.${field}`);
    }
  });

  it("marca la variación con flecha además del color, y el aviso de datos viejos no termina en doble punto", () => {
    expect(source).toContain("▲");
    expect(source).toContain("▼");
    expect(source).not.toContain('". pueden');
    expect(source).toContain("pueden estar desactualizados");
  });

  it("escribe solo con textContent: lo guardado nunca se interpreta como HTML", () => {
    expect(source).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/,
    );
  });
});
