import { describe, expect, it } from "vitest";
import type { CompanyData } from "@/lib/market-data";
import { formatCompact, formatRatio } from "../format";
import { d } from "@/lib/engine";
import { buildCompanyRows } from "../company-view";

const empty: CompanyData = {
  kind: "stock",
  currency: null,
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
  earnings: [],
};

const googl: CompanyData = {
  ...empty,
  previousClose: "342.36",
  open: "342.41",
  dayLow: "341.11",
  dayHigh: "347.03",
  fiftyTwoWeekLow: "235.84",
  fiftyTwoWeekHigh: "408.61",
  volume: 21242195,
  averageVolume: 28826158,
  marketCap: 4206119354368,
  trailingPE: "17.2564",
  forwardPE: "23.0831",
  epsTrailing: "19.93",
  dividendRate: "0.88",
  dividendYield: "0.0026",
  sharesOutstanding: 12229934831,
  floatShares: 10879441100,
  priceToBook: "6.7573",
  bookValue: "50.896",
  priceToSales: "9.4336",
  beta: "1.225",
};

/** ICU usa espacios de no separación: se normalizan para poder escribir el esperado a mano. */
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");
const asMap = (rows: ReturnType<typeof buildCompanyRows>) =>
  Object.fromEntries(rows.map((r) => [r.label, plain(r.value)]));

describe("formatCompact", () => {
  it.each([
    [21242195, "21,24 millones"],
    [28826158, "28,83 millones"],
    [4206119354368, "4,21 billones"],
    [12229934831, "12,23 mil millones"],
    [5081234567, "5,08 mil millones"],
    [1756880437248, "1,76 billones"],
    [12500, "12,5 mil"],
    [950, "950"],
    [0, "0"],
  ])("%d → %s", (value, text) => {
    expect(formatCompact(value)).toBe(text);
  });

  it("en singular cuando es exactamente uno", () => {
    expect(formatCompact(1_000_000)).toBe("1 millón");
    expect(formatCompact(1_000_000_000_000)).toBe("1 billón");
    expect(formatCompact(1_000_000_000)).toBe("1 mil millones");
  });

  it("un valor que redondea a mil pasa a la unidad siguiente", () => {
    expect(formatCompact(999_996_000)).toBe("1 mil millones");
    expect(formatCompact(999_996)).toBe("1 millón");
    expect(formatCompact(999_996_000_000)).toBe("1 billón");
  });

  it("sin dato o con un valor roto, un guion", () => {
    expect(formatCompact(null)).toBe("—");
    expect(formatCompact(Number.NaN)).toBe("—");
    expect(formatCompact(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatRatio", () => {
  it("siempre 2 decimales, coma decimal", () => {
    expect(formatRatio(d("17.2564"))).toBe("17,26");
    expect(formatRatio(d("6.7"))).toBe("6,70");
    expect(formatRatio(null)).toBe("—");
  });
});

describe("buildCompanyRows: acción", () => {
  const rows = asMap(buildCompanyRows(googl));

  it("muestra los datos de la captura con el formato de la app", () => {
    expect(rows).toMatchObject({
      "Cierre anterior": "US$ 342,36",
      Apertura: "US$ 342,41",
      "Rango del día": "US$ 341,11 – 347,03",
      "Rango de 52 semanas": "US$ 235,84 – 408,61",
      Volumen: "21,24 millones",
      "Volumen promedio (3 meses)": "28,83 millones",
      "Capitalización bursátil": "US$ 4,21 billones",
      "P/E (12 meses)": "17,26",
      "P/E (próximos 12 meses)": "23,08",
      "BPA (12 meses)": "US$ 19,93",
      "Dividendo anual": "US$ 0,88",
      "Acciones en circulación": "12,23 mil millones",
      "Acciones flotantes": "10,88 mil millones",
      "P/B (precio / valor contable)": "6,76",
      "Valor contable por acción": "US$ 50,90",
      "Precio / ventas": "9,43",
      Beta: "1,23",
    });
    expect(rows["Rentabilidad por dividendo"]).toMatch(/^0,26\s?%$/);
  });

  it("respeta el orden de la captura", () => {
    expect(
      buildCompanyRows(googl)
        .map((r) => r.label)
        .slice(0, 4),
    ).toEqual([
      "Cierre anterior",
      "Apertura",
      "Rango del día",
      "Rango de 52 semanas",
    ]);
  });

  it("un precio bajo no pierde precisión", () => {
    const low = asMap(buildCompanyRows({ ...googl, previousClose: "0.5123" }));
    expect(low["Cierre anterior"]).toBe("US$ 0,5123");
  });

  it("el BPA negativo se muestra con su signo", () => {
    const loss = asMap(buildCompanyRows({ ...googl, epsTrailing: "-1.5" }));
    expect(loss["BPA (12 meses)"]).toMatch(/^US\$ -1,50$|^-US\$ 1,50$/);
  });

  it("un dato que falta no deja una fila vacía", () => {
    const partial = asMap(
      buildCompanyRows({ ...googl, marketCap: null, beta: null }),
    );
    expect(partial).not.toHaveProperty("Capitalización bursátil");
    expect(partial).not.toHaveProperty("Beta");
    expect(Object.values(partial)).not.toContain("—");
  });

  it("un rango necesita los dos extremos", () => {
    const half = asMap(buildCompanyRows({ ...googl, dayLow: null }));
    expect(half).not.toHaveProperty("Rango del día");
  });

  it("sin ningún dato no hay filas (la tarjeta se oculta)", () => {
    expect(buildCompanyRows(empty)).toEqual([]);
  });
});

describe("buildCompanyRows: ETF", () => {
  const etf: CompanyData = {
    ...empty,
    kind: "etf",
    previousClose: "706.99",
    open: "708.44",
    dayLow: "706.175",
    dayHigh: "711.645",
    fiftyTwoWeekLow: "578.46",
    fiftyTwoWeekHigh: "716.39",
    volume: 5421633,
    averageVolume: 7081333,
    trailingPE: "25.0019",
    dividendYield: "0.0104",
    totalAssets: 1756880437248,
    navPrice: "707.38",
    category: "Large Blend",
    ytdReturn: "0.135253",
    // Campos de acción que un ETF no debe mostrar aunque vinieran:
    marketCap: 5,
    epsTrailing: "3",
    beta: "1",
  };
  const rows = asMap(buildCompanyRows(etf));

  it("muestra lo suyo: patrimonio, cuota, categoría y retorno del año", () => {
    expect(rows).toMatchObject({
      "Patrimonio total": "US$ 1,76 billones",
      "Valor de la cuota (NAV)": "US$ 707,38",
      Categoría: "Large Blend",
      "Rango de 52 semanas": "US$ 578,46 – 716,39",
      "P/E (12 meses)": "25,00",
    });
    expect(rows["Rentabilidad por dividendo"]).toMatch(/^1,04\s?%$/);
    expect(rows["Retorno en el año"]).toMatch(/^13,53\s?%$/);
  });

  it("no muestra filas de acción", () => {
    for (const label of [
      "Capitalización bursátil",
      "BPA (12 meses)",
      "Beta",
      "Acciones en circulación",
      "Dividendo anual",
    ]) {
      expect(rows).not.toHaveProperty(label);
    }
  });
});
