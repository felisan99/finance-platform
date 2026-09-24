import { describe, expect, it } from "vitest";
import { computeEngine, d, valuePortfolio, type PriceInfo } from "@/lib/engine";
import { buy, deposit } from "@/lib/engine/__tests__/helpers";
import {
  MAX_NAMED_SLICES,
  PALETTE_SIZE,
  buildAllocationViews,
  type AllocationSliceView,
  type AllocationView,
} from "../allocation-view";

const T = "2026-01-05T15:00:00Z";

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

const quote = (value: string): PriceInfo => ({
  price: d(value),
  asOf: new Date("2026-09-23T20:00:00Z"),
  source: "quote",
  previousClose: null,
});

const noTypes = () => null;

function view(
  views: { views: AllocationView[] } | null,
  dimension: AllocationView["dimension"],
): AllocationView {
  const found = views?.views.find((v) => v.dimension === dimension);
  if (!found) throw new Error(`sin vista ${dimension}`);
  return found;
}

const rows = (slices: readonly AllocationSliceView[]) =>
  slices.map((s) => [s.label, s.color, plain(s.amount), plain(s.percent)]);

describe("buildAllocationViews: una cartera chica", () => {
  // 5000 depositados; VOO 10 a 100 (1000) y AAA 4 a 50 (200) => efectivo 3800.
  // Valores: VOO 1200, AAA 240; total 1200 + 240 + 3800 = 5240.
  const valued = valuePortfolio(
    computeEngine([
      deposit(T, "5000"),
      buy(T, "VOO", "10", "100"),
      buy(T, "AAA", "4", "50"),
    ]),
    new Map([
      ["VOO", quote("120")],
      ["AAA", quote("60")],
    ]),
  );
  const types: Record<string, string> = { VOO: "ETF", AAA: "STOCK" };
  const views = buildAllocationViews(valued, (s) => types[s] ?? null);

  it("el total es el valor del portafolio", () => {
    expect(plain(views!.total)).toBe("US$ 5.240,00");
  });

  it("por posición: el efectivo con su gris y las posiciones con colores de la paleta en orden", () => {
    expect(rows(view(views, "position").slices)).toEqual([
      ["Efectivo", "var(--alloc-cash)", "US$ 3.800,00", "72,52%"], // 3800 / 5240
      ["VOO", "var(--alloc-1)", "US$ 1.200,00", "22,90%"], // 1200 / 5240
      ["AAA", "var(--alloc-2)", "US$ 240,00", "4,58%"], // 240 / 5240
    ]);
  });

  it("por posición no repite los símbolos como detalle", () => {
    expect(view(views, "position").slices.map((s) => s.detail)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("por tipo: nombres en español y qué símbolos hay adentro", () => {
    const type = view(views, "type").slices;
    expect(rows(type)).toEqual([
      ["Efectivo", "var(--alloc-cash)", "US$ 3.800,00", "72,52%"],
      ["ETF", "var(--alloc-1)", "US$ 1.200,00", "22,90%"],
      ["Acciones", "var(--alloc-2)", "US$ 240,00", "4,58%"],
    ]);
    expect(type.map((s) => s.detail)).toEqual([null, "VOO", "AAA"]);
  });

  it("`share` (el ángulo) suma 1 y coincide con el porcentaje mostrado", () => {
    const slices = view(views, "position").slices;
    const sum = slices.reduce((acc, s) => acc + s.share, 0);
    expect(sum).toBeCloseTo(1, 12);
    expect(slices[0]!.share).toBeCloseTo(3800 / 5240, 12);
  });

  it("los ids son únicos (sirven de clave en la lista)", () => {
    for (const v of views!.views) {
      expect(new Set(v.slices.map((s) => s.id)).size).toBe(v.slices.length);
    }
  });
});

describe("buildAllocationViews: tipos raros", () => {
  const valued = valuePortfolio(
    computeEngine([
      deposit(T, "1000"),
      buy(T, "AAA", "1", "100"),
      buy(T, "BBB", "1", "100"),
      buy(T, "CCC", "1", "100"),
    ]),
    new Map([
      ["AAA", quote("300")],
      ["BBB", quote("200")],
      ["CCC", quote("100")],
    ]),
  );

  it("se normaliza el tipo (espacios y mayúsculas) y uno desconocido se muestra capitalizado", () => {
    const types: Record<string, string | null> = {
      AAA: " etf ",
      BBB: "crypto",
      CCC: null,
    };
    const type = view(
      buildAllocationViews(valued, (s) => types[s] ?? null),
      "type",
    ).slices;
    expect(type.map((s) => s.label)).toEqual([
      "Efectivo", // 1000 − 300 = 700
      "ETF", // AAA 300
      "Crypto", // BBB 200
      "Sin clasificar", // CCC 100
    ]);
  });

  it("un tipo vacío cuenta como sin clasificar", () => {
    const type = view(
      buildAllocationViews(valued, () => "  "),
      "type",
    ).slices;
    expect(type.map((s) => s.label)).toEqual(["Efectivo", "Sin clasificar"]);
    expect(type[1]!.detail).toBe("AAA, BBB, CCC");
  });
});

describe("buildAllocationViews: la cola va a «Otros»", () => {
  /** N posiciones P1..PN que valen 100·(N−i+1)... ver cada caso; efectivo = 100 − N (compras de 1 a 1). */
  function portfolio(count: number) {
    const symbols = Array.from({ length: count }, (_, i) => `P${i + 1}`);
    const valued = valuePortfolio(
      computeEngine([
        deposit(T, "100"),
        ...symbols.map((s) => buy(T, s, "1", "1")),
      ]),
      // P1 vale 800, P2 700, … hasta bajar de a 100.
      new Map(
        symbols.map((s, i) => [s, quote(String((8 - i) * 100))] as const),
      ),
    );
    return buildAllocationViews(valued, noTypes);
  }

  it("con exactamente el máximo de porciones con nombre no se junta nada", () => {
    expect(MAX_NAMED_SLICES).toBe(PALETTE_SIZE);
    const slices = view(portfolio(6), "position").slices;
    expect(slices.map((s) => s.label)).toEqual([
      "P1", // 800
      "P2", // 700
      "P3", // 600
      "P4", // 500
      "P5", // 400
      "P6", // 300
      "Efectivo", // 100 − 6 = 94
    ]);
    expect(
      slices.filter((s) => s.label !== "Efectivo").map((s) => s.color),
    ).toEqual([1, 2, 3, 4, 5, 6].map((i) => `var(--alloc-${i})`));
  });

  it("con una más, las últimas se juntan en «Otros» (siempre al final) y el efectivo sigue aparte", () => {
    // 8 posiciones: 800 700 600 500 400 | 300 200 100 => Otros = 600; efectivo 100 − 8 = 92; total 3692.
    const slices = view(portfolio(8), "position").slices;
    expect(rows(slices)).toEqual([
      ["P1", "var(--alloc-1)", "US$ 800,00", "21,67%"], // 800 / 3692
      ["P2", "var(--alloc-2)", "US$ 700,00", "18,96%"], // 700 / 3692
      ["P3", "var(--alloc-3)", "US$ 600,00", "16,25%"], // 600 / 3692
      ["P4", "var(--alloc-4)", "US$ 500,00", "13,54%"], // 500 / 3692
      ["P5", "var(--alloc-5)", "US$ 400,00", "10,83%"], // 400 / 3692
      ["Efectivo", "var(--alloc-cash)", "US$ 92,00", "2,49%"], // 92 / 3692
      ["Otros", "var(--alloc-other)", "US$ 600,00", "16,25%"], // (300 + 200 + 100) / 3692
    ]);
    expect(slices.at(-1)!.detail).toBe("P6, P7, P8");
  });

  it("nunca hay más colores que los de la paleta", () => {
    const slices = view(portfolio(8), "position").slices;
    const numbered = slices
      .map((s) => /^var\(--alloc-(\d+)\)$/.exec(s.color)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    expect(Math.max(...numbered)).toBeLessThanOrEqual(PALETTE_SIZE);
    expect(new Set(numbered).size).toBe(numbered.length);
  });
});

describe("buildAllocationViews: el detalle de «Otros»", () => {
  it("lista los símbolos en orden alfabético aunque valgan distinto", () => {
    // Cinco grandes (800 a 400) y una cola de ZZZ 300, MMM 200 y AAA 100: por valor irían ZZZ, MMM, AAA.
    const big = ["B1", "B2", "B3", "B4", "B5"];
    const tail = ["ZZZ", "MMM", "AAA"];
    const symbols = [...big, ...tail];
    const valued = valuePortfolio(
      computeEngine([
        deposit(T, "100"),
        ...symbols.map((s) => buy(T, s, "1", "1")),
      ]),
      new Map(
        symbols.map((s, i) => [s, quote(String((8 - i) * 100))] as const),
      ),
    );
    const slices = view(
      buildAllocationViews(valued, noTypes),
      "position",
    ).slices;
    expect(slices.at(-1)).toMatchObject({
      label: "Otros",
      detail: "AAA, MMM, ZZZ",
    });
  });
});

describe("buildAllocationViews: casos límite", () => {
  it("sin nada que dibujar devuelve null", () => {
    const valued = valuePortfolio(computeEngine([]), new Map());
    expect(buildAllocationViews(valued, noTypes)).toBeNull();
  });

  it("solo efectivo: una porción del 100 %", () => {
    const valued = valuePortfolio(
      computeEngine([deposit(T, "250")]),
      new Map(),
    );
    const slices = view(
      buildAllocationViews(valued, noTypes),
      "position",
    ).slices;
    expect(rows(slices)).toEqual([
      ["Efectivo", "var(--alloc-cash)", "US$ 250,00", "100,00%"],
    ]);
  });
});
