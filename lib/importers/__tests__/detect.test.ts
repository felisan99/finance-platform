import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORMAT_LABELS,
  FORMAT_SOURCE,
  buildImportTemplate,
  parseDeltaCsv,
  parseImport,
} from "@/lib/importers";

const NOW = new Date("2026-09-25T12:00:00Z");
const DELTA = readFileSync(
  resolve(process.cwd(), "lib/engine/__fixtures__/delta_export.csv"),
  "utf8",
);

describe("parseImport: reconoce el formato por los encabezados", () => {
  it("un export de Delta se lee igual que con parseDeltaCsv", () => {
    const detected = parseImport(DELTA, NOW);
    expect(detected.format).toBe("delta");
    expect(detected.result).toEqual(parseDeltaCsv(DELTA));
    expect(detected.result.transactions.length).toBeGreaterThan(0);
  });

  it("un archivo con fecha y tipo es del formato simple", () => {
    const detected = parseImport(
      "fecha,tipo,simbolo,cantidad,precio\n2026-03-09,compra,VOO,3,600",
      NOW,
    );
    expect(detected.format).toBe("simple");
    expect(detected.result.transactions).toHaveLength(1);
    expect(detected.result.errors).toEqual([]);
  });

  it("acepta los encabezados en inglés y con otro delimitador", () => {
    const detected = parseImport(
      "Date;Type;Symbol;Quantity;Price\n2026-03-09;BUY;VOO;3;600,5",
      NOW,
    );
    expect(detected.format).toBe("simple");
    expect(detected.result.errors).toEqual([]);
  });

  it("un Delta incompleto sigue siendo Delta y dice qué columnas le faltan", () => {
    const detected = parseImport("Date,Way,Base amount\n2026-03-09,BUY,3", NOW);
    expect(detected.format).toBe("delta");
    expect(detected.result.fatal).toMatchObject({ code: "MISSING_COLUMNS" });
    expect(detected.result.fatal?.message).toContain("Base currency (name)");
  });

  it("una columna llamada Way o Base amount sola no lo vuelve un export de Delta", () => {
    for (const extra of ["Way", "Base amount"]) {
      const detected = parseImport(
        `fecha,tipo,simbolo,cantidad,precio,${extra}\n2026-03-09,compra,VOO,3,600,x`,
        NOW,
      );
      expect(detected.format).toBe("simple");
      expect(detected.result.errors).toEqual([]);
      expect(detected.result.transactions).toHaveLength(1);
    }
  });

  it("con fecha pero sin tipo (o al revés) no se reconoce: dice qué falta", () => {
    for (const header of ["fecha,simbolo,cantidad", "tipo,simbolo,cantidad"]) {
      const detected = parseImport(`${header}\n2026-03-09,VOO,3`, NOW);
      expect(detected.format).toBeNull();
      expect(detected.result.fatal?.code).toBe("UNKNOWN_FORMAT");
      expect(detected.result.fatal?.message).toContain("«fecha» y «tipo»");
    }
  });

  it("un archivo que no es ninguno: error con las columnas encontradas y qué hacer", () => {
    const detected = parseImport("Nombre,Edad\nAna,30", NOW);
    expect(detected.format).toBeNull();
    expect(detected.result.fatal?.code).toBe("UNKNOWN_FORMAT");
    expect(detected.result.fatal?.message).toContain("Nombre, Edad");
    expect(detected.result.fatal?.message).toContain("plantilla");
    expect(detected.result.transactions).toEqual([]);
  });

  it("un archivo vacío", () => {
    expect(parseImport("", NOW)).toMatchObject({
      format: null,
      result: { fatal: { code: "EMPTY_FILE" } },
    });
    const bom = String.fromCharCode(0xfeff);
    expect(parseImport(`${bom}\n`, NOW).result.fatal?.code).toBe("EMPTY_FILE");
  });

  it("los nombres de las columnas de un archivo raro no desbordan el mensaje", () => {
    const columns = Array.from({ length: 30 }, (_, i) =>
      `columna${i}x`.repeat(5),
    );
    const detected = parseImport(
      `${columns.join(",")}\n${columns.join(",")}`,
      NOW,
    );
    expect(detected.result.fatal?.code).toBe("UNKNOWN_FORMAT");
    expect(detected.result.fatal?.message.length).toBeLessThan(400);
  });

  it("cada formato tiene su origen y su etiqueta", () => {
    expect(FORMAT_SOURCE).toEqual({ delta: "delta_csv", simple: "csv" });
    expect(FORMAT_LABELS.simple).toBe("Portfolio Tracker");
    expect(FORMAT_LABELS.delta).toBe("Delta");
  });
});

describe("plantilla", () => {
  it("empieza con BOM, usa CRLF y trae el encabezado y cinco ejemplos", () => {
    const text = buildImportTemplate();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.endsWith("\r\n")).toBe(true);
    const lines = text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "fecha,tipo,simbolo,cantidad,precio,monto,comision,notas",
    );
    expect(lines).toHaveLength(6);
    // Sin comillas ni comas dentro de las celdas: no hace falta entrecomillar.
    for (const line of lines) expect(line.split(",")).toHaveLength(8);
    expect(text).not.toContain('"');
  });

  it("subida sin tocar: se reconoce, pero ninguna fila entra (todas son ejemplos)", () => {
    const detected = parseImport(buildImportTemplate(), NOW);
    expect(detected.format).toBe("simple");
    expect(detected.result.transactions).toEqual([]);
    expect(detected.result.errors).toHaveLength(5);
    expect(detected.result.errors.every((e) => e.code === "TEMPLATE_ROW")).toBe(
      true,
    );
    expect(detected.result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6]);
    expect(detected.result.instruments).toEqual([]);
    expect(detected.result.stats).toMatchObject({ imported: 0, errors: 5 });
  });

  it("los ejemplos que sobran mezclados con filas propias se rechazan; las propias entran", () => {
    const own = "2026-03-09,compra,MELI,1,1612.45,,1,mía";
    const text = `${buildImportTemplate()}${own}\r\n`;
    const { result } = parseImport(text, NOW);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      symbol: "MELI",
      sourceRow: 7,
    });
    expect(result.errors.filter((e) => e.code === "TEMPLATE_ROW")).toHaveLength(
      5,
    );
    expect(result.instruments.map((i) => i.symbol)).toEqual(["MELI"]);
  });

  it("una fila de ejemplo repetida (y por eso con sufijo #2) también se rechaza", () => {
    const lines = buildImportTemplate().trimEnd().split("\r\n");
    const doubled = [...lines, lines[1]!, lines[1]!].join("\r\n");
    const { result } = parseImport(doubled, NOW);
    expect(result.transactions).toEqual([]);
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("los errores salen ordenados por fila, mezclando los de la plantilla con los del archivo", () => {
    const bad = "2026-03-09,regalo,VOO,1,10,,,";
    const { result } = parseImport(`${buildImportTemplate()}${bad}\r\n`, NOW);
    expect(result.errors.map((e) => [e.row, e.code])).toEqual([
      [2, "TEMPLATE_ROW"],
      [3, "TEMPLATE_ROW"],
      [4, "TEMPLATE_ROW"],
      [5, "TEMPLATE_ROW"],
      [6, "TEMPLATE_ROW"],
      [7, "INVALID_TYPE"],
    ]);
  });

  it("una fila de ejemplo con un dato cambiado ya es otra operación", () => {
    const edited = buildImportTemplate().replace("400.50", "401.50");
    const { result } = parseImport(edited, NOW);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      symbol: "VOO",
      type: "BUY",
    });
    expect(result.errors).toHaveLength(4);
  });

  it("sin las notas de ejemplo también se reconocen (la clave no usa las notas)", () => {
    const stripped = buildImportTemplate().replace(/Ejemplo[^\r\n]*/g, "");
    const { result } = parseImport(stripped, NOW);
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(5);
  });

  it("la plantilla, leída sin el filtro de ejemplos, es válida y da lo esperado", async () => {
    const { parseSimpleCsv } = await import("@/lib/importers");
    const r = parseSimpleCsv(buildImportTemplate(), NOW);
    expect(r.errors).toEqual([]);
    expect(
      r.transactions.map((t) => [t.type, "symbol" in t ? t.symbol : null]),
    ).toEqual([
      ["DEPOSIT", null],
      ["BUY", "VOO"],
      ["BUY", "AAPL"],
      ["SELL", "VOO"],
      ["DIVIDEND", "VOO"],
    ]);
    const [, voo, aapl] = r.transactions;
    expect(voo && "quantity" in voo && voo.quantity.toFixed()).toBe("2");
    expect(aapl && "quantity" in aapl && aapl.quantity.toFixed()).toBe("0.5");
  });
});
