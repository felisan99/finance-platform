import { describe, expect, it } from "vitest";
import { d, type Transaction } from "@/lib/engine";
import { parseImport } from "@/lib/importers";
import type { ResolveResult } from "@/lib/market-jobs/instruments";
import {
  MAX_ROWS_SHOWN,
  buildImportPreview,
  type ImportPreviewArgs,
} from "../import-preview";
import { MAX_VERIFIED_SYMBOLS } from "../import-symbols";
import { ACCOUNT_ID, FIXTURE_CSV } from "./fixture";

const NOW = new Date("2026-09-25T12:00:00Z");
const HEADER = "fecha,tipo,simbolo,cantidad,precio,monto,comision,notas";

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const DEPOSIT = "2026-03-06,deposito,,,,5000,,";
const BUY_VOO = "2026-03-09,compra,VOO,3,575.24,,1,";

const ok = (symbol: string, type: "STOCK" | "ETF" = "ETF"): ResolveResult => ({
  ok: true,
  instrument: { symbol, name: `${symbol} (nombre del proveedor)`, type },
});
const notFound: ResolveResult = {
  ok: false,
  reason: "NOT_FOUND",
  message: "No encontramos el símbolo",
};
const unavailable: ResolveResult = {
  ok: false,
  reason: "UNAVAILABLE",
  message: "No pudimos verificar el símbolo ahora",
};

function preview(
  text: string,
  over: Partial<ImportPreviewArgs> = {},
  checks: Record<string, ResolveResult> | null = null,
) {
  const { format, result } = parseImport(text, NOW);
  return buildImportPreview({
    parsed: result,
    format,
    importedExternalIds: new Set(),
    existingTransactions: [],
    knownSymbols: new Set(),
    symbolChecks: checks === null ? null : new Map(Object.entries(checks)),
    accountId: ACCOUNT_ID,
    now: NOW,
    ...over,
  });
}

const manualBuy = (
  iso: string,
  symbol: string,
  quantity: string,
): Transaction => ({
  id: `m-${iso}`,
  accountId: ACCOUNT_ID,
  type: "BUY",
  symbol,
  executedAt: new Date(iso),
  createdAt: new Date("2026-09-01T00:00:00Z"),
  currency: "USD",
  quantity: d(quantity),
  price: d("610"),
  fee: d("0"),
});

describe("vista previa del formato simple", () => {
  it("rotula el formato y lista las operaciones interpretadas, con textos ya formateados", () => {
    const { view } = preview(csv(DEPOSIT, BUY_VOO), {}, { VOO: ok("VOO") });
    expect(view.format).toEqual({ key: "simple", label: "Portfolio Tracker" });
    expect(view.canConfirm).toBe(true);
    expect(view.newCount).toBe(2);
    expect(view.rows).toEqual([
      {
        row: 2,
        date: "06/03/2026",
        typeLabel: "Depósito",
        symbol: "",
        detail: expect.stringContaining("5.000,00"),
      },
      {
        row: 3,
        date: "09/03/2026",
        typeLabel: "Compra",
        symbol: "VOO",
        detail: expect.stringMatching(/^3 × .*575,24 · comisión .*1,00$/),
      },
    ]);
    expect(view.rowsHidden).toBe(0);
  });

  it("el formato de Delta también se rotula", () => {
    const { view } = preview(FIXTURE_CSV);
    expect(view.format).toEqual({ key: "delta", label: "Delta" });
    expect(view.canConfirm).toBe(true);
    // Las filas de Delta se listan igual: la persona ve lo que se va a cargar.
    expect(view.rows.length).toBeGreaterThan(0);
    expect(view.rows[0]).toMatchObject({
      typeLabel: "Depósito",
      date: "06/03/2026",
    });
  });

  it("un archivo que no se reconoce no tiene formato y explica qué hacer", () => {
    const { view } = preview("Nombre,Edad\nAna,30");
    expect(view.format).toBeNull();
    expect(view.fatal?.code).toBe("UNKNOWN_FORMAT");
    expect(view.canConfirm).toBe(false);
    expect(view.problems[0]).toContain("plantilla");
  });

  it("solo lista las primeras filas y cuenta las que sobran", () => {
    const many = Array.from(
      { length: MAX_ROWS_SHOWN + 25 },
      (_, i) => `2026-03-06,deposito,,,,${i + 1},,`,
    );
    const { view, toInsert } = preview(csv(...many));
    expect(view.rows).toHaveLength(MAX_ROWS_SHOWN);
    expect(view.rowsHidden).toBe(25);
    expect(toInsert).toHaveLength(MAX_ROWS_SHOWN + 25);
    expect(view.newCount).toBe(MAX_ROWS_SHOWN + 25);
  });

  it("la vista sigue siendo serializable y no expone claves internas", () => {
    const { view } = preview(csv(DEPOSIT, BUY_VOO), {}, { VOO: ok("VOO") });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.stringify(view)).not.toMatch(/externalId|executedAt/);
  });
});

describe("parecidas a lo que ya tenés", () => {
  const existing = [manualBuy("2026-03-09T22:34:00Z", "VOO", "3")];

  it("se excluyen por defecto, se listan aparte y no se insertan", () => {
    const { view, toInsert } = preview(
      csv(DEPOSIT, BUY_VOO),
      { existingTransactions: existing, knownSymbols: new Set(["VOO"]) },
      {},
    );
    expect(view.suspectedCount).toBe(1);
    expect(view.duplicateCount).toBe(0);
    expect(view.suspectedIncluded).toBe(false);
    expect(view.suspected).toEqual([
      expect.objectContaining({ row: 3, typeLabel: "Compra", symbol: "VOO" }),
    ]);
    expect(view.newCount).toBe(1);
    expect(toInsert.map((t) => t.type)).toEqual(["DEPOSIT"]);
    expect(view.canConfirm).toBe(true);
  });

  it("con «Importar igual» entran, y el resultado las cuenta", () => {
    const { view, toInsert } = preview(
      csv(DEPOSIT, BUY_VOO),
      {
        existingTransactions: existing,
        knownSymbols: new Set(["VOO"]),
        includeSuspected: true,
      },
      {},
    );
    expect(view.suspectedIncluded).toBe(true);
    expect(view.suspectedCount).toBe(1);
    expect(view.newCount).toBe(2);
    expect(toInsert).toHaveLength(2);
    // Con la compra manual y la del archivo, las posiciones quedan dobles: es lo que la persona pidió.
    expect(view.after?.openPositions).toEqual([
      expect.objectContaining({ symbol: "VOO", quantity: "6" }),
    ]);
  });

  it("si TODO parece repetido, no hay nada que confirmar y el mensaje dice cómo seguir", () => {
    const { view } = preview(
      csv(BUY_VOO),
      { existingTransactions: existing, knownSymbols: new Set(["VOO"]) },
      {},
    );
    expect(view.newCount).toBe(0);
    expect(view.canConfirm).toBe(false);
    expect(view.problems).toEqual([
      "Todas las operaciones parecen repetir las que ya tenés cargadas. Si no lo son, tildá «Importar igual».",
    ]);
  });

  it("lo ya importado (mismo id) no es «parecido»: es un duplicado exacto", () => {
    const { parsed } = { parsed: parseImport(csv(BUY_VOO), NOW).result };
    const ids = new Set(parsed.transactions.map((t) => t.externalId));
    const { view } = preview(
      csv(BUY_VOO),
      {
        importedExternalIds: ids,
        existingTransactions: existing,
        knownSymbols: new Set(["VOO"]),
      },
      {},
    );
    expect(view.duplicateCount).toBe(1);
    expect(view.suspectedCount).toBe(0);
    expect(view.problems).toEqual([
      "No hay operaciones nuevas: todas ya estaban importadas.",
    ]);
  });
});

describe("verificación de símbolos nuevos", () => {
  it("los instrumentos nuevos salen del proveedor (nombre y tipo reales)", () => {
    const { view, newInstruments } = preview(
      csv(DEPOSIT, BUY_VOO),
      {},
      { VOO: ok("VOO", "ETF") },
    );
    expect(view.newSymbols).toEqual(["VOO"]);
    expect(newInstruments).toEqual([
      { symbol: "VOO", name: "VOO (nombre del proveedor)", type: "ETF" },
    ]);
  });

  it("un símbolo que ya existe no se verifica ni se vuelve a crear", () => {
    const { view, newInstruments } = preview(
      csv(DEPOSIT, BUY_VOO),
      { knownSymbols: new Set(["VOO"]) },
      {},
    );
    expect(view.canConfirm).toBe(true);
    expect(newInstruments).toEqual([]);
  });

  it("un símbolo que no existe es un error de esa fila y bloquea", () => {
    const { view, toInsert } = preview(
      csv(DEPOSIT, "2026-03-09,compra,APPL,1,100,,,", BUY_VOO),
      {},
      { APPL: notFound, VOO: ok("VOO") },
    );
    expect(view.canConfirm).toBe(false);
    expect(view.errorCount).toBe(1);
    expect(view.errorGroups).toEqual([
      {
        code: "INVALID_SYMBOL",
        label: "Símbolos inválidos",
        count: 1,
        examples: [
          {
            row: 3,
            message:
              "Símbolo «APPL»: no lo encontramos. Revisá que esté bien escrito.",
          },
        ],
      },
    ]);
    expect(view.problems[0]).toMatch(/1 fila con errores/);
    // La fila con el símbolo malo no se inserta, y su símbolo no se da de alta.
    expect(toInsert.map((t) => t.sourceRow)).toEqual([2, 4]);
    expect(view.newSymbols).toEqual(["VOO"]);
  });

  it("un instrumento que no se soporta (otra moneda, no es acción) usa el mensaje del proveedor", () => {
    const { view } = preview(
      csv(DEPOSIT, "2026-03-09,compra,BTC-USD,1,100,,,"),
      {},
      {
        "BTC-USD": {
          ok: false,
          reason: "UNSUPPORTED",
          message: "Por ahora solo se admiten acciones y ETFs",
        },
      },
    );
    expect(view.errorGroups[0]?.examples[0]?.message).toBe(
      "Símbolo «BTC-USD»: Por ahora solo se admiten acciones y ETFs",
    );
    expect(view.canConfirm).toBe(false);
  });

  it("si el proveedor no responde: bloquea, sin marcar la fila como error del archivo", () => {
    const { view } = preview(csv(DEPOSIT, BUY_VOO), {}, { VOO: unavailable });
    expect(view.canConfirm).toBe(false);
    expect(view.errorCount).toBe(0);
    expect(view.problems).toEqual([
      "No pudimos verificar VOO con Yahoo Finance ahora. Probá de nuevo en unos minutos.",
    ]);
  });

  it("más símbolos nuevos de los que se verifican: pide importar en partes", () => {
    const symbols = Array.from(
      { length: MAX_VERIFIED_SYMBOLS + 1 },
      (_, i) => `S${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`,
    );
    const rows = symbols.map((s) => `2026-03-09,compra,${s},1,10,,,`);
    const checks = Object.fromEntries(
      symbols.slice(0, MAX_VERIFIED_SYMBOLS).map((s) => [s, ok(s, "STOCK")]),
    );
    const { view } = preview(csv(DEPOSIT, ...rows), {}, checks);
    expect(view.canConfirm).toBe(false);
    expect(view.problems).toContain(
      `El archivo tiene más de ${MAX_VERIFIED_SYMBOLS} símbolos nuevos: importalo en partes.`,
    );
  });

  it("sin verificación (Delta), los instrumentos salen del archivo como antes", () => {
    const { newInstruments } = preview(csv(DEPOSIT, BUY_VOO), {}, null);
    expect(newInstruments).toEqual([
      { symbol: "VOO", name: null, type: "STOCK" },
    ]);
  });
});

describe("errores agrupados", () => {
  it("agrupa por causa, cuenta todas y muestra pocas filas de ejemplo de cada una", () => {
    const badDates = Array.from(
      { length: 8 },
      (_, i) => `31/02/2026,compra,VOO,${i + 1},600,,,`,
    );
    const { view } = preview(
      csv(DEPOSIT, ...badDates, "2026-03-09,regalo,,,,,,"),
      {},
      {},
    );
    expect(view.errorGroups.map((g) => [g.code, g.count])).toEqual([
      ["INVALID_DATE", 8],
      ["INVALID_TYPE", 1],
    ]);
    expect(view.errorGroups[0]?.examples).toHaveLength(5);
    expect(view.errorGroups[0]?.label).toBe("Fechas inválidas");
    expect(view.errorCount).toBe(9);
    expect(view.problems[0]).toMatch(/9 filas con errores/);
  });

  it("una fila con varios problemas cuenta como una sola fila con errores", () => {
    const { view } = preview(csv("2026-03-09,compra,,,,,,"), {}, {});
    expect(view.errorCount).toBe(3);
    expect(view.problems[0]).toMatch(/1 fila con errores/);
  });

  it("las filas de ejemplo de la plantilla se agrupan aparte", async () => {
    const { buildImportTemplate } = await import("@/lib/importers");
    const { view } = preview(buildImportTemplate(), {}, {});
    expect(view.errorGroups).toEqual([
      expect.objectContaining({ code: "TEMPLATE_ROW", count: 5 }),
    ]);
    expect(view.canConfirm).toBe(false);
  });
});

describe("límites", () => {
  it("exactamente 5000 operaciones se pueden importar", () => {
    const rows = Array.from(
      { length: 5000 },
      (_, i) => `2026-03-06,deposito,,,,${i + 1},,`,
    );
    const { view } = preview(csv(...rows), {}, {});
    expect(view.canConfirm).toBe(true);
    expect(view.newCount).toBe(5000);
  });

  it("más de 5000 operaciones: pide dividir el archivo", () => {
    const rows = Array.from(
      { length: 5001 },
      (_, i) => `2026-03-06,deposito,,,,${i + 1},,`,
    );
    const { view } = preview(csv(...rows), {}, {});
    expect(view.canConfirm).toBe(false);
    expect(view.problems.some((p) => /hasta 5000/.test(p))).toBe(true);
  });
});
