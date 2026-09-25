import { describe, expect, it } from "vitest";
import type { CompanyData, EarningsQuarter } from "@/lib/market-data";
import { buildEarningsView } from "../earnings-view";

const NOW = new Date("2026-09-25T20:00:00.000Z");
/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string | null) =>
  value === null ? null : value.replace(/[\u00a0\u202f]/g, " ");

function stock(
  earnings: EarningsQuarter[],
  extra: Partial<CompanyData> = {},
): CompanyData {
  return {
    kind: "stock",
    currency: "USD",
    previousClose: null,
    open: null,
    dayLow: null,
    dayHigh: null,
    fiftyTwoWeekLow: null,
    fiftyTwoWeekHigh: null,
    volume: null,
    averageVolume: null,
    marketCap: null,
    trailingPE: null,
    forwardPE: null,
    epsTrailing: null,
    dividendRate: null,
    dividendYield: null,
    sharesOutstanding: null,
    floatShares: null,
    priceToBook: null,
    bookValue: null,
    priceToSales: null,
    beta: null,
    totalAssets: null,
    navPrice: null,
    category: null,
    ytdReturn: null,
    nextEarningsDate: null,
    exDividendDate: null,
    earnings,
    ...extra,
  };
}
const q = (
  periodEnd: string,
  actual: string | null,
  estimate: string | null,
): EarningsQuarter => ({
  periodEnd,
  epsActual: actual,
  epsEstimate: estimate,
  epsDifference: null,
});

const googl = stock([
  q("2025-09-30", "2.87", "2.26204"),
  q("2025-12-31", "2.82", "2.63521"),
  q("2026-03-31", "5.11", "2.66714"),
  q("2026-06-30", "9.11", "2.89914"),
]);

describe("buildEarningsView", () => {
  const view = buildEarningsView(googl, NOW)!;

  it("un renglón por trimestre, en el orden recibido, con su etiqueta calendario", () => {
    expect(view.bars.map((b) => b.label)).toEqual([
      "T3 2025",
      "T4 2025",
      "T1 2026",
      "T2 2026",
    ]);
  });

  it("el trimestre es el calendario en el que cierra el período, aunque no termine en fin de trimestre", () => {
    const v = buildEarningsView(
      stock([
        q("2025-11-30", "1", "1"), // período fiscal que cierra en noviembre → T4
        q("2026-01-31", "1", "1"), // enero → T1 (no T0)
        q("2026-04-30", "1", "1"), // abril → T2
        q("2026-08-31", "1", "1"), // agosto → T3
      ]),
      NOW,
    )!;
    expect(v.bars.map((b) => b.label)).toEqual([
      "T4 2025",
      "T1 2026",
      "T2 2026",
      "T3 2026",
    ]);
  });

  it("todos superaron: veredicto y la diferencia real menos el consenso", () => {
    expect(view.bars.map((b) => b.verdictText)).toEqual([
      "Superó",
      "Superó",
      "Superó",
      "Superó",
    ]);
    expect(view.bars.map((b) => plain(b.diffText))).toEqual([
      "por US$ 0,61",
      "por US$ 0,18",
      "por US$ 2,44",
      "por US$ 6,21",
    ]);
    expect(plain(view.bars[0]!.actualText)).toBe("US$ 2,87");
    expect(plain(view.bars[0]!.estimateText)).toBe("US$ 2,26");
  });

  it("la barra más alta llega arriba y las demás son proporcionales", () => {
    const last = view.bars[3]!;
    expect(last.top).toBeCloseTo(0, 5);
    expect(last.height).toBeCloseTo(100, 5);
    expect(view.bars[0]!.height).toBeCloseTo((2.87 / 9.11) * 100, 4);
    // El consenso se dibuja a la altura de su valor.
    expect(last.estimateY).toBeCloseTo((1 - 2.89914 / 9.11) * 100, 4);
  });

  it("un consenso más alto que todos los BPA también entra en la escala", () => {
    const v = buildEarningsView(
      stock([q("2026-03-31", "1.00", "4.00"), q("2026-06-30", "2.00", "4.00")]),
      NOW,
    )!;
    // El consenso (4,00) es el máximo: su marca queda arriba de todo y las barras miden contra él.
    expect(v.bars[0]!.estimateY).toBeCloseTo(0, 5);
    expect(v.bars[0]!.height).toBeCloseTo(25, 5);
    expect(v.bars[1]!.height).toBeCloseTo(50, 5);
  });

  it("un trimestre que no llegó al consenso", () => {
    const v = buildEarningsView(stock([q("2026-03-31", "1.90", "2.10")]), NOW)!;
    expect(v.bars[0]).toMatchObject({
      verdict: "miss",
      verdictText: "No llegó",
    });
    expect(plain(v.bars[0]!.diffText)).toBe("por US$ 0,20");
  });

  it("una diferencia que se muestra como 0,00 es «en línea», sin «por»", () => {
    const v = buildEarningsView(
      stock([q("2026-03-31", "2.10", "2.1049")]),
      NOW,
    )!;
    expect(v.bars[0]).toMatchObject({
      verdict: "inline",
      verdictText: "En línea",
      diffText: null,
    });
  });

  it("justo en el umbral (0,005) ya cuenta", () => {
    const v = buildEarningsView(
      stock([q("2026-03-31", "2.105", "2.10")]),
      NOW,
    )!;
    expect(v.bars[0]!.verdict).toBe("beat");
  });

  it("sin consenso no hay veredicto ni marca", () => {
    const v = buildEarningsView(stock([q("2026-03-31", "2.10", null)]), NOW)!;
    expect(v.bars[0]).toMatchObject({
      verdict: null,
      verdictText: null,
      diffText: null,
      estimateText: null,
      estimateY: null,
    });
  });

  it("un BPA negativo cuelga de la línea del cero", () => {
    const v = buildEarningsView(
      stock([
        q("2026-03-31", "-0.50", "-0.30"),
        q("2026-06-30", "1.00", "0.80"),
      ]),
      NOW,
    )!;
    const loss = v.bars[0]!;
    expect(loss.negative).toBe(true);
    expect(loss.top).toBeCloseTo(v.zeroY, 5);
    expect(loss.height).toBeGreaterThan(0);
    expect(v.bars[1]!.top + v.bars[1]!.height).toBeCloseTo(v.zeroY, 5);
    expect(loss.verdict).toBe("miss");
  });

  it("un BPA de cero no dibuja barra pero el trimestre sigue", () => {
    const v = buildEarningsView(
      stock([q("2026-03-31", "0", "0.10"), q("2026-06-30", "1.00", "0.80")]),
      NOW,
    )!;
    expect(v.bars[0]!.height).toBe(0);
  });

  it("una barra chica frente a las otras no desaparece", () => {
    const v = buildEarningsView(
      stock([q("2026-03-31", "0.01", "0.01"), q("2026-06-30", "100", "90")]),
      NOW,
    )!;
    expect(v.bars[0]!.height).toBeGreaterThanOrEqual(1.5);
  });

  it("el texto para lectores de pantalla dice todo lo que dice la barra", () => {
    expect(plain(view.bars[0]!.summary)).toBe(
      "T3 2025: BPA US$ 2,87, consenso US$ 2,26, superó, por US$ 0,61",
    );
  });

  it("la fecha de resultados solo se muestra si es futura", () => {
    const future = buildEarningsView(
      { ...googl, nextEarningsDate: "2026-10-28" },
      NOW,
    )!;
    expect(future.nextText).toBe("Próximos resultados: 28/10/2026");
    const past = buildEarningsView(
      { ...googl, nextEarningsDate: "2026-07-22" },
      NOW,
    )!;
    expect(past.nextText).toBeNull();
    const sameDay = buildEarningsView(
      { ...googl, nextEarningsDate: "2026-09-25" },
      NOW,
    )!;
    expect(sameDay.nextText).toBeNull();
    expect(buildEarningsView(googl, NOW)!.nextText).toBeNull();
  });

  it("un ETF o una acción sin trimestres publicados no tiene tarjeta", () => {
    expect(buildEarningsView({ ...googl, kind: "etf" }, NOW)).toBeNull();
    expect(buildEarningsView(stock([]), NOW)).toBeNull();
    expect(
      buildEarningsView(stock([q("2026-03-31", null, "2.1")]), NOW),
    ).toBeNull();
  });
});
