import { describe, expect, it } from "vitest";
import { d } from "@/lib/engine";
import {
  currencyCode,
  parseDeltaCsv,
  parseInstrument,
  toEngineTransactions,
} from "@/lib/importers";

const COLUMNS = [
  "Date",
  "Way",
  "Base amount",
  "Base currency (name)",
  "Base type",
  "Quote amount",
  "Quote currency",
  "Exchange",
  "Sent/Received from",
  "Sent to",
  "Fee amount",
  "Fee currency (name)",
  "Broker",
  "Notes",
  "Sync Base Holding",
  "Leverage Metadata",
] as const;

type Column = (typeof COLUMNS)[number];

const HEADER = COLUMNS.map((c) => `"${c}"`).join(",");

/** Arma una fila con el formato de Delta: textos entre comillas, números y vacíos sin ellas. */
function row(fields: Partial<Record<Column, string | number>>): string {
  return COLUMNS.map((column) => {
    const value = fields[column];
    if (value === undefined) return "";
    return typeof value === "number" ? String(value) : `"${value}"`;
  }).join(",");
}

const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

const VOO = "VOO (Vanguard S&P 500 ETF)";
const USD = "USD (United States dollar)";

function tradeRow(
  overrides: Partial<Record<Column, string | number>> = {},
): string {
  return row({
    Date: "2026-03-09T22:34:00.000Z",
    Way: "BUY",
    "Base amount": 3,
    "Base currency (name)": VOO,
    "Base type": "FUND",
    "Quote amount": 1725.72,
    "Quote currency": "USD",
    "Fee amount": 1,
    "Fee currency (name)": "USD",
    ...overrides,
  });
}

function cashRow(
  overrides: Partial<Record<Column, string | number>> = {},
): string {
  return row({
    Date: "2026-03-06T22:30:00.000Z",
    Way: "DEPOSIT",
    "Base amount": 4200,
    "Base currency (name)": USD,
    "Base type": "FIAT",
    ...overrides,
  });
}

describe("parseDeltaCsv — filas de ejemplo del spec (§8.1)", () => {
  // Las cuatro filas tal cual las publica el spec (con las 16 columnas).
  const spec = [
    HEADER,
    '"2026-03-06T22:30:00.000Z","DEPOSIT",4200,"USD (United States dollar)","FIAT",,,,"OTHER","MY_WALLET",,,"","Comision 30USD",false,',
    '"2026-03-09T22:34:00.000Z","BUY",3,"VOO (Vanguard S&P 500 ETF)","FUND",1725.72,"USD","New York Stock Exchange",,,1,"USD",,,true,',
    '"2026-03-09T22:34:00.000Z","WITHDRAW",1726.72,"USD (United States dollar)","FIAT",,,"New York Stock Exchange","MY_WALLET","OTHER",,,,"SYNC-BASE-HOLDINGS_BUY_VOO/USD",false,',
    '"2026-04-06T22:42:00.000Z","SELL",37,"KOS (Kosmos Energy Ltd)","STOCK",117.105,"USD","New York Stock Exchange",,,1,"USD",,,true,',
  ].join("\n");

  it("mapea DEPOSIT, BUY y SELL, e ignora la pata SYNC", () => {
    const r = parseDeltaCsv(spec);
    expect(r.fatal).toBeNull();
    expect(r.errors).toEqual([]);
    expect(r.stats).toEqual({
      rowsTotal: 4,
      imported: 3,
      skipped: 1,
      errors: 0,
    });
    expect(r.skipped).toEqual([
      {
        row: 4,
        reason: "SYNC_BASE_HOLDINGS_LEG",
        detail:
          "Pata de efectivo automática de Delta (SYNC-BASE-HOLDINGS_BUY_VOO/USD)",
      },
    ]);

    const [deposit, buy, sell] = r.transactions;
    expect(deposit).toMatchObject({
      type: "DEPOSIT",
      symbol: null,
      currency: "USD",
      notes: "Comision 30USD",
      sourceRow: 2,
    });
    expect(deposit && "amount" in deposit && deposit.amount.toFixed()).toBe(
      "4200",
    );

    expect(buy).toMatchObject({
      type: "BUY",
      symbol: "VOO",
      sourceRow: 3,
      source: "delta_csv",
    });
    if (buy?.type === "BUY") {
      expect([
        buy.quantity.toFixed(),
        buy.price.toFixed(),
        buy.fee.toFixed(),
      ]).toEqual(["3", "575.24", "1"]);
    }
    if (sell?.type === "SELL") {
      expect([
        sell.quantity.toFixed(),
        sell.price.toFixed(),
        sell.fee.toFixed(),
      ]).toEqual(["37", "3.165", "1"]);
    }
    expect(sell).toMatchObject({ type: "SELL", symbol: "KOS", sourceRow: 5 });
  });

  it("el externalId es una clave canónica fecha|way|símbolo|base|quote", () => {
    const [deposit, buy] = parseDeltaCsv(spec).transactions;
    expect(deposit?.externalId).toBe(
      "delta:2026-03-06T22:30:00.000Z|DEPOSIT||4200|",
    );
    expect(buy?.externalId).toBe(
      "delta:2026-03-09T22:34:00.000Z|BUY|VOO|3|1725.72",
    );
  });
});

describe("parseDeltaCsv — formato del archivo", () => {
  const body = file(cashRow(), tradeRow());

  it("no exige el salto de línea final (el export de Delta no lo tiene)", () => {
    expect(body.endsWith("\n")).toBe(false);
    expect(parseDeltaCsv(body).stats.imported).toBe(2);
    expect(parseDeltaCsv(body + "\n").stats).toEqual(parseDeltaCsv(body).stats);
  });

  it("acepta CRLF y BOM y da el mismo resultado", () => {
    const base = parseDeltaCsv(body);
    const crlf = parseDeltaCsv(body.replace(/\n/g, "\r\n"));
    const bom = parseDeltaCsv(String.fromCharCode(0xfeff) + body);
    expect(crlf.transactions.map((t) => t.externalId)).toEqual(
      base.transactions.map((t) => t.externalId),
    );
    expect(bom.transactions.map((t) => t.externalId)).toEqual(
      base.transactions.map((t) => t.externalId),
    );
    expect(crlf.errors).toEqual([]);
    expect(bom.fatal).toBeNull();
  });

  it("ignora las líneas en blanco", () => {
    const r = parseDeltaCsv([HEADER, cashRow(), "", tradeRow(), ""].join("\n"));
    expect(r.stats).toEqual({
      rowsTotal: 2,
      imported: 2,
      skipped: 0,
      errors: 0,
    });
  });

  it("conserva comas dentro de un campo entre comillas", () => {
    const r = parseDeltaCsv(file(cashRow({ Notes: "Comision, 30USD" })));
    expect(r.transactions[0]).toMatchObject({ notes: "Comision, 30USD" });
  });

  it("un archivo vacío es un error fatal", () => {
    expect(parseDeltaCsv("").fatal).toMatchObject({ code: "EMPTY_FILE" });
    expect(parseDeltaCsv("  \n \n").fatal).toMatchObject({
      code: "EMPTY_FILE",
    });
  });

  it("si faltan columnas es un error fatal y se nombran", () => {
    const r = parseDeltaCsv('"Date","Way"\n"2026-03-06T22:30:00.000Z","BUY"');
    expect(r.fatal?.code).toBe("MISSING_COLUMNS");
    expect(r.fatal?.message).toContain("Base amount");
    expect(r.fatal?.message).toContain("Quote amount");
    expect(r.transactions).toEqual([]);
    expect(r.stats.rowsTotal).toBe(0);
  });

  it("solo con el encabezado no hay filas ni errores", () => {
    const r = parseDeltaCsv(HEADER);
    expect(r.fatal).toBeNull();
    expect(r.stats).toEqual({
      rowsTotal: 0,
      imported: 0,
      skipped: 0,
      errors: 0,
    });
  });

  it("una fila con campos de menos es MALFORMED_ROW y no frena a las demás", () => {
    const r = parseDeltaCsv(
      [HEADER, '"2026-03-06T22:30:00.000Z","DEPOSIT",4200', cashRow()].join(
        "\n",
      ),
    );
    expect(r.errors).toMatchObject([{ row: 2, code: "MALFORMED_ROW" }]);
    expect(r.stats).toEqual({
      rowsTotal: 2,
      imported: 1,
      skipped: 0,
      errors: 1,
    });
  });
});

describe("parseDeltaCsv — clasificación de filas", () => {
  it("BUY sin comisión (Fee amount vacío) tiene fee 0", () => {
    const r = parseDeltaCsv(
      file(
        tradeRow({ "Fee amount": undefined, "Fee currency (name)": undefined }),
      ),
    );
    expect(r.errors).toEqual([]);
    const [buy] = r.transactions;
    expect(buy?.type === "BUY" && buy.fee.isZero()).toBe(true);
  });

  it("WITHDRAW real (FIAT sin nota SYNC) es WITHDRAWAL", () => {
    const r = parseDeltaCsv(
      file(cashRow({ Way: "WITHDRAW", "Base amount": 250 })),
    );
    expect(r.transactions[0]).toMatchObject({
      type: "WITHDRAWAL",
      symbol: null,
    });
  });

  it("acepta Way en minúsculas", () => {
    expect(parseDeltaCsv(file(tradeRow({ Way: "buy" }))).stats.imported).toBe(
      1,
    );
  });

  it("las patas SYNC de venta (DEPOSIT) también se ignoran", () => {
    const r = parseDeltaCsv(
      file(
        cashRow({
          "Base amount": 116.105,
          Notes: "SYNC-BASE-HOLDINGS_SELL_KOS/USD",
        }),
      ),
    );
    expect(r.stats).toEqual({
      rowsTotal: 1,
      imported: 0,
      skipped: 1,
      errors: 0,
    });
    expect(r.skipped[0]?.reason).toBe("SYNC_BASE_HOLDINGS_LEG");
  });

  it("un Way desconocido se ignora con motivo (no se descarta en silencio)", () => {
    const r = parseDeltaCsv(file(tradeRow({ Way: "TRANSFER" })));
    expect(r.skipped).toEqual([
      {
        row: 2,
        reason: "UNSUPPORTED_WAY",
        detail: 'Way "TRANSFER" no soportado',
      },
    ]);
    expect(r.transactions).toEqual([]);
  });

  it("cripto y otros tipos de activo se ignoran con motivo", () => {
    const r = parseDeltaCsv(
      file(
        tradeRow({
          "Base currency (name)": "BTC (Bitcoin)",
          "Base type": "CRYPTO",
        }),
        cashRow({ "Base type": "CRYPTO" }),
      ),
    );
    expect(r.skipped.map((s) => s.reason)).toEqual([
      "UNSUPPORTED_ASSET_TYPE",
      "UNSUPPORTED_ASSET_TYPE",
    ]);
    expect(r.transactions).toEqual([]);
  });

  it("una moneda distinta de USD se ignora con motivo", () => {
    const r = parseDeltaCsv(
      file(
        tradeRow({ "Quote currency": "EUR" }),
        cashRow({ "Base currency (name)": "EUR (Euro)" }),
        tradeRow({ "Fee currency (name)": "EUR" }),
      ),
    );
    expect(r.skipped.map((s) => s.reason)).toEqual([
      "UNSUPPORTED_CURRENCY",
      "UNSUPPORTED_CURRENCY",
      "UNSUPPORTED_CURRENCY",
    ]);
    expect(r.skipped[2]?.detail).toContain("Fee currency EUR");
    expect(r.transactions).toEqual([]);
  });

  it("la moneda de la comisión se ignora si no hay comisión", () => {
    const r = parseDeltaCsv(
      file(tradeRow({ "Fee amount": undefined, "Fee currency (name)": "EUR" })),
    );
    expect(r.stats.imported).toBe(1);
  });
});

describe("parseDeltaCsv — errores de fila", () => {
  const cases: [string, string, string][] = [
    ["cantidad 0", tradeRow({ "Base amount": 0 }), "INVALID_QUANTITY"],
    ["cantidad negativa", tradeRow({ "Base amount": -3 }), "INVALID_QUANTITY"],
    ["total negativo", tradeRow({ "Quote amount": -10 }), "INVALID_AMOUNT"],
    ["comisión negativa", tradeRow({ "Fee amount": -1 }), "INVALID_AMOUNT"],
    ["depósito de 0", cashRow({ "Base amount": 0 }), "INVALID_AMOUNT"],
    [
      "depósito con monto no numérico",
      cashRow({ "Base amount": "mil" }),
      "INVALID_ROW",
    ],
    ["depósito con fecha inválida", cashRow({ Date: "ayer" }), "INVALID_ROW"],
    ["fecha inválida", tradeRow({ Date: "ayer" }), "INVALID_ROW"],
    [
      "fecha sin zona horaria",
      tradeRow({ Date: "2026-03-09T22:34:00" }),
      "INVALID_ROW",
    ],
    [
      "cantidad no numérica",
      tradeRow({ "Base amount": "tres" }),
      "INVALID_ROW",
    ],
    ["total ausente", tradeRow({ "Quote amount": undefined }), "INVALID_ROW"],
    ["Way ausente", tradeRow({ Way: undefined }), "INVALID_ROW"],
    [
      "símbolo ilegible",
      tradeRow({ "Base currency (name)": "(sin símbolo)" }),
      "INVALID_SYMBOL",
    ],
  ];

  it.each(cases)("%s -> %s", (_name, line, code) => {
    const r = parseDeltaCsv(file(line));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 2, code });
    expect(r.errors[0]?.message.length).toBeGreaterThan(0);
    expect(r.transactions).toEqual([]);
    expect(r.stats).toEqual({
      rowsTotal: 1,
      imported: 0,
      skipped: 0,
      errors: 1,
    });
  });

  it("el mensaje de una fila inválida nombra la columna", () => {
    const r = parseDeltaCsv(file(tradeRow({ "Base amount": "tres" })));
    expect(r.errors[0]?.message).toContain("Base amount");
  });

  it("una fila mala no frena a las buenas y los números de fila son los del archivo", () => {
    const r = parseDeltaCsv(
      file(cashRow(), tradeRow({ "Base amount": 0 }), tradeRow()),
    );
    expect(r.stats).toEqual({
      rowsTotal: 3,
      imported: 2,
      skipped: 0,
      errors: 1,
    });
    expect(r.errors[0]?.row).toBe(3);
    expect(r.transactions.map((t) => t.sourceRow)).toEqual([2, 4]);
  });

  it("imported + skipped + errors = rowsTotal", () => {
    const r = parseDeltaCsv(
      file(
        cashRow(),
        tradeRow(),
        tradeRow({ Way: "TRANSFER" }),
        tradeRow({ "Base amount": 0 }),
        cashRow({ Notes: "SYNC-BASE-HOLDINGS_BUY_VOO/USD" }),
      ),
    );
    const { rowsTotal, imported, skipped, errors } = r.stats;
    expect(rowsTotal).toBe(5);
    expect(imported + skipped + errors).toBe(rowsTotal);
  });
});

describe("parseDeltaCsv — precio, símbolo y duplicados", () => {
  it("el precio se redondea a 8 decimales (numeric(20,8))", () => {
    const r = parseDeltaCsv(
      file(tradeRow({ "Base amount": 3, "Quote amount": 100 })),
    );
    const [buy] = r.transactions;
    expect(buy?.type === "BUY" && buy.price.toFixed()).toBe("33.33333333");
  });

  it("los totales con 5 decimales dan precios exactos", () => {
    const r = parseDeltaCsv(
      file(
        tradeRow({
          "Base amount": 0.537,
          "Quote amount": 129.51366,
          "Base currency (name)": "TTWO (Take-Two Interactive Software Inc)",
          "Base type": "STOCK",
        }),
      ),
    );
    const [buy] = r.transactions;
    expect(buy?.type === "BUY" && buy.price.toFixed()).toBe("241.18");
  });

  it("normaliza el símbolo y registra el instrumento una sola vez", () => {
    const r = parseDeltaCsv(
      file(
        tradeRow({
          "Base currency (name)": "BRK.B (Berkshire Hathaway Inc)",
          "Base type": "STOCK",
        }),
        tradeRow({
          "Base currency (name)": "brk.b (Berkshire Hathaway Inc)",
          "Base type": "STOCK",
          Date: "2026-03-10T22:34:00.000Z",
        }),
      ),
    );
    expect(r.transactions.map((t) => t.symbol)).toEqual(["BRK-B", "BRK-B"]);
    expect(r.instruments).toEqual([
      { symbol: "BRK-B", name: "Berkshire Hathaway Inc", type: "STOCK" },
    ]);
  });

  it("las filas idénticas dentro del archivo llevan sufijo #2, #3…", () => {
    const r = parseDeltaCsv(file(tradeRow(), tradeRow(), tradeRow()));
    const ids = r.transactions.map((t) => t.externalId);
    const key = "delta:2026-03-09T22:34:00.000Z|BUY|VOO|3|1725.72";
    expect(ids).toEqual([key, `${key}#2`, `${key}#3`]);
  });

  it("el mismo archivo da siempre los mismos externalId", () => {
    const text = file(cashRow(), tradeRow(), tradeRow());
    expect(parseDeltaCsv(text).transactions.map((t) => t.externalId)).toEqual(
      parseDeltaCsv(text).transactions.map((t) => t.externalId),
    );
  });

  it("ordena por fecha y conserva el orden del archivo en los empates", () => {
    const r = parseDeltaCsv(
      file(
        tradeRow({
          Date: "2026-03-11T00:00:00.000Z",
          "Base amount": 1,
          "Quote amount": 10,
        }),
        tradeRow({
          Date: "2026-03-09T00:00:00.000Z",
          "Base amount": 2,
          "Quote amount": 20,
        }),
        tradeRow({
          Date: "2026-03-09T00:00:00.000Z",
          "Base amount": 3,
          "Quote amount": 30,
        }),
      ),
    );
    expect(r.transactions.map((t) => t.sourceRow)).toEqual([3, 4, 2]);
  });
});

describe("parseInstrument y currencyCode", () => {
  it("separa símbolo y nombre", () => {
    expect(parseInstrument("VOO (Vanguard S&P 500 ETF)")).toEqual({
      symbol: "VOO",
      name: "Vanguard S&P 500 ETF",
    });
    expect(parseInstrument("TTWO (Take-Two Interactive Software Inc)")).toEqual(
      {
        symbol: "TTWO",
        name: "Take-Two Interactive Software Inc",
      },
    );
  });

  it("acepta un símbolo sin nombre y nombres con paréntesis", () => {
    expect(parseInstrument("SPY")).toEqual({ symbol: "SPY", name: null });
    expect(parseInstrument("ABC (Foo (Bar) Inc)")).toEqual({
      symbol: "ABC",
      name: "Foo (Bar) Inc",
    });
  });

  it("pasa a mayúsculas y cambia el punto por guion", () => {
    expect(parseInstrument("brk.b (Berkshire)")?.symbol).toBe("BRK-B");
  });

  it("rechaza lo que no parece un símbolo", () => {
    expect(parseInstrument("")).toBeNull();
    expect(parseInstrument("(solo nombre)")).toBeNull();
    expect(parseInstrument("BAD$ (x)")).toBeNull();
  });

  it("currencyCode toma lo anterior al primer espacio", () => {
    expect(currencyCode("USD (United States dollar)")).toBe("USD");
    expect(currencyCode("usd")).toBe("USD");
    expect(currencyCode("")).toBe("");
  });
});

describe("toEngineTransactions", () => {
  it("arma las transacciones del motor con id = externalId y un createdAt común", () => {
    const r = parseDeltaCsv(file(cashRow(), tradeRow()));
    const importedAt = new Date("2026-09-23T12:00:00Z");
    const txs = toEngineTransactions(r.transactions, {
      accountId: "acc-9",
      importedAt,
    });

    expect(txs).toHaveLength(2);
    expect(txs.map((t) => t.id)).toEqual(
      r.transactions.map((t) => t.externalId),
    );
    for (const tx of txs) {
      expect(tx.accountId).toBe("acc-9");
      expect(tx.createdAt).toBe(importedAt);
    }
    const buy = txs[1];
    expect(buy?.type).toBe("BUY");
    if (buy?.type === "BUY") expect(buy.price.equals(d("575.24"))).toBe(true);
  });
});
