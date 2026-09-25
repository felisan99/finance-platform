import { describe, expect, it } from "vitest";
import {
  parseDeltaCsv,
  toEngineTransactions,
  type ImportParseResult,
} from "@/lib/importers";
import { buildImportPreview, type ImportPreviewArgs } from "../import-preview";
import { ACCOUNT_ID, FIXTURE_CSV } from "./fixture";

const NOW = new Date("2026-09-24T18:00:00Z");
const parsedFixture = () => parseDeltaCsv(FIXTURE_CSV);

const args = (over: Partial<ImportPreviewArgs> = {}): ImportPreviewArgs => ({
  parsed: parsedFixture(),
  importedExternalIds: new Set(),
  existingTransactions: [],
  knownSymbols: new Set(),
  accountId: ACCOUNT_ID,
  now: NOW,
  ...over,
});

describe("buildImportPreview: el CSV de Delta en una cuenta vacía", () => {
  const preview = buildImportPreview(args());
  const { view } = preview;

  it("se puede confirmar y no hay problemas ni avisos", () => {
    expect(view.canConfirm).toBe(true);
    expect(view.problems).toEqual([]);
    expect(view.warnings).toEqual([]);
    expect(view.fatal).toBeNull();
  });

  it("cuenta lo que se crea y lo que se ignora a propósito", () => {
    const parsed = parsedFixture();
    expect(view.newCount).toBe(parsed.transactions.length);
    expect(view.duplicateCount).toBe(0);
    expect(view.fileRows).toBe(parsed.stats.rowsTotal);
    expect(view.errorCount).toBe(0);
    // Cada compra y venta trae su pata de efectivo automática de Delta: se ignoran con motivo.
    const sync = view.skipped.find(
      (s) => s.reason === "SYNC_BASE_HOLDINGS_LEG",
    );
    expect(sync?.count).toBeGreaterThan(0);
    expect(sync?.label).toMatch(/Patas de efectivo automáticas/);
    expect(sync?.rows.length).toBeLessThanOrEqual(5);
    expect(view.newByType.reduce((n, t) => n + t.count, 0)).toBe(view.newCount);
    expect(view.newByType.find((t) => t.type === "BUY")?.count).toBeGreaterThan(
      0,
    );
  });

  it("los 10 símbolos son nuevos", () => {
    expect([...view.newSymbols].sort()).toEqual([
      "FSLY",
      "ILF",
      "KOS",
      "MELI",
      "NFLX",
      "QCOM",
      "SOXX",
      "TTWO",
      "URTH",
      "VOO",
    ]);
    expect(preview.newInstruments.map((i) => i.symbol).sort()).toEqual(
      [...view.newSymbols].sort(),
    );
    expect(
      preview.newInstruments.find((i) => i.symbol === "VOO"),
    ).toMatchObject({ type: "ETF", name: "Vanguard S&P 500 ETF" });
  });

  it("cómo quedaría el portafolio: los números de la sección 8.3", () => {
    expect(view.after?.cash).toBe("882.745");
    expect(view.after?.openCostBasis).toBe("8664.27");
    expect(view.after?.realizedPnl).toBe("247.015");
    expect(
      view.after?.openPositions.map((p) => [p.symbol, p.quantity, p.costBasis]),
    ).toEqual([
      ["FSLY", "20", "346.8"],
      ["ILF", "10", "331.6"],
      ["NFLX", "3", "191.6"],
      ["SOXX", "3", "2069.5"],
      ["VOO", "8.95", "5724.77"],
    ]);
  });

  it("los textos del resultado vienen ya formateados (es-UY), con el valor exacto al lado", () => {
    const flat = (text: string | undefined) => text?.replace(/\s/g, " ");
    expect(flat(view.afterText?.cash.money)).toBe("US$ 882,75");
    expect(view.afterText?.cash.exact).toBe("882,745");
    expect(flat(view.afterText?.openCostBasis.money)).toBe("US$ 8.664,27");
    expect(flat(view.afterText?.realizedPnl.money)).toBe("+US$ 247,02");
    expect(view.afterText?.openPositions.map((p) => p.symbol)).toEqual([
      "FSLY",
      "ILF",
      "NFLX",
      "SOXX",
      "VOO",
    ]);
    const voo = view.afterText?.openPositions.find((p) => p.symbol === "VOO");
    expect(voo?.quantity).toBe("8,95");
    expect(flat(voo?.costBasis)).toBe("US$ 5.724,77");
  });

  it("los tipos de operación llevan su rótulo en español", () => {
    expect(view.newByType.find((t) => t.type === "BUY")?.label).toBe("Compra");
    expect(view.newByType.find((t) => t.type === "DEPOSIT")?.label).toBe(
      "Depósito",
    );
  });

  it("`toInsert` son todos los borradores, en el orden del archivo", () => {
    expect(preview.toInsert.map((t) => t.externalId)).toEqual(
      parsedFixture().transactions.map((t) => t.externalId),
    );
  });

  it("la vista es serializable (viaja al cliente) y no expone las operaciones", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.stringify(view)).not.toMatch(/externalId|executedAt/);
  });
});

describe("buildImportPreview: reimportar", () => {
  it("el mismo archivo otra vez: todo duplicado, no hay nada que confirmar", () => {
    const parsed = parsedFixture();
    const preview = buildImportPreview(
      args({
        importedExternalIds: new Set(
          parsed.transactions.map((t) => t.externalId),
        ),
      }),
    );
    expect(preview.view.newCount).toBe(0);
    expect(preview.view.duplicateCount).toBe(parsed.transactions.length);
    expect(preview.view.canConfirm).toBe(false);
    expect(preview.view.problems).toEqual([
      "No hay operaciones nuevas: todas ya estaban importadas.",
    ]);
    expect(preview.toInsert).toEqual([]);
  });

  it("un archivo que solapa con lo ya importado: solo entra lo nuevo y el resultado es el mismo", () => {
    const parsed = parsedFixture();
    const already = parsed.transactions.slice(0, 20);
    const preview = buildImportPreview(
      args({
        importedExternalIds: new Set(already.map((t) => t.externalId)),
        existingTransactions: toEngineTransactions(already, {
          accountId: ACCOUNT_ID,
          importedAt: new Date("2026-08-01T00:00:00Z"),
        }),
        knownSymbols: new Set(["VOO"]),
      }),
    );
    expect(preview.view.duplicateCount).toBe(20);
    expect(preview.view.newCount).toBe(parsed.transactions.length - 20);
    expect(preview.view.canConfirm).toBe(true);
    // El resultado final es el de importar todo junto.
    expect(preview.view.after?.cash).toBe("882.745");
    expect(preview.view.after?.openCostBasis).toBe("8664.27");
    expect(preview.view.newSymbols).not.toContain("VOO");
  });

  it("los símbolos que ya existen no se vuelven a crear", () => {
    const known = new Set(["VOO", "MELI"]);
    const preview = buildImportPreview(args({ knownSymbols: known }));
    expect(preview.view.newSymbols).not.toContain("VOO");
    expect(preview.view.newSymbols).not.toContain("MELI");
    expect(preview.view.newSymbols).toHaveLength(8);
  });
});

describe("buildImportPreview: lo que impide confirmar", () => {
  it("una venta sin compra previa se rechaza y dice en qué fila del archivo está", () => {
    const parsed = parsedFixture();
    const sells = parsed.transactions.filter((t) => t.type === "SELL");
    const preview = buildImportPreview(
      args({ parsed: { ...parsed, transactions: sells } }),
    );
    expect(preview.view.canConfirm).toBe(false);
    expect(preview.view.problems.length).toBeGreaterThan(0);
    expect(preview.view.problems[0]).toMatch(
      /Vende .* pero solo hay 0 disponibles \(fila \d+ del archivo\)/,
    );
  });

  it("filas con error del archivo: bloquean, y se listan (acotadas)", () => {
    const header = FIXTURE_CSV.split("\n")[0]!;
    const bad = `"2026-03-09T22:34:00.000Z","BUY",abc,"VOO (Vanguard S&P 500 ETF)","FUND",1725.72,"USD","New York Stock Exchange",,,1,"USD",,,true,`;
    const parsed = parseDeltaCsv(`${header}\n${bad}\n`);
    expect(parsed.errors.length).toBeGreaterThan(0);
    const { view } = buildImportPreview(args({ parsed }));
    expect(view.canConfirm).toBe(false);
    expect(view.errorCount).toBe(parsed.errors.length);
    expect(view.errors[0]).toMatchObject({ row: 2 });
    expect(view.problems.some((p) => /fila.* con errores/.test(p))).toBe(true);
  });

  it("si hay muchos errores solo se muestran los primeros 50, pero se cuentan todos", () => {
    const header = FIXTURE_CSV.split("\n")[0]!;
    const bad = `"2026-03-09T22:34:00.000Z","BUY",abc,"VOO (Vanguard S&P 500 ETF)","FUND",1725.72,"USD","NYSE",,,1,"USD",,,true,`;
    const parsed = parseDeltaCsv(
      `${header}\n${Array.from({ length: 120 }, () => bad).join("\n")}\n`,
    );
    const { view } = buildImportPreview(args({ parsed }));
    expect(view.errorCount).toBe(120);
    expect(view.errors).toHaveLength(50);
  });

  it("un problema del archivo entero (vacío, sin columnas) se informa y no rompe", () => {
    for (const text of ["", "Date,Way\n2026-01-01,BUY\n"]) {
      const { view, toInsert } = buildImportPreview(
        args({ parsed: parseDeltaCsv(text) }),
      );
      expect(view.fatal).not.toBeNull();
      expect(view.canConfirm).toBe(false);
      expect(view.problems).toEqual([view.fatal?.message]);
      expect(view.after).toBeNull();
      expect(toInsert).toEqual([]);
    }
  });

  it("un archivo sin operaciones (solo filas ignoradas)", () => {
    const parsed = parsedFixture();
    const empty: ImportParseResult = {
      ...parsed,
      transactions: [],
      instruments: [],
    };
    const { view } = buildImportPreview(args({ parsed: empty }));
    expect(view.canConfirm).toBe(false);
    expect(view.problems).toEqual([
      "El archivo no tiene operaciones para importar.",
    ]);
  });
});

describe("buildImportPreview: avisos que no impiden confirmar", () => {
  it("efectivo negativo tras importar: se avisa pero se puede confirmar", () => {
    const parsed = parsedFixture();
    const noDeposits = parsed.transactions.filter((t) => t.type !== "DEPOSIT");
    const { view } = buildImportPreview(
      args({ parsed: { ...parsed, transactions: noDeposits } }),
    );
    expect(view.canConfirm).toBe(true);
    expect(view.warnings.some((w) => /efectivo queda negativo/.test(w))).toBe(
      true,
    );
  });

  it("si el efectivo ya era negativo antes, no es un aviso nuevo", () => {
    const parsed = parsedFixture();
    const buysOnly = parsed.transactions
      .filter((t) => t.type === "BUY")
      .slice(0, 2);
    const existing = toEngineTransactions(buysOnly, {
      accountId: ACCOUNT_ID,
      importedAt: NOW,
    });
    const rest = parsed.transactions
      .filter((t) => t.type === "BUY")
      .slice(2, 3);
    const { view } = buildImportPreview(
      args({
        parsed: { ...parsed, transactions: rest },
        existingTransactions: existing,
        importedExternalIds: new Set(),
      }),
    );
    expect(view.warnings).toEqual([]);
  });
});
