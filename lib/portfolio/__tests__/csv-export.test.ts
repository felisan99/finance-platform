import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildTransactionsCsv, CSV_COLUMNS, csvText } from "../csv-export";
import type { TransactionRow } from "../rows";
import { fixtureInstruments, fixtureRows } from "./fixture";

const row = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: "r1",
  type: "BUY",
  instrument_id: "i-voo",
  executed_at: "2026-03-09T22:34:00+00:00",
  quantity: "3.00000000",
  price: "575.24000000",
  amount: null,
  fee: "1.0000",
  currency: "USD",
  split_ratio: null,
  notes: null,
  source: "manual",
  external_id: null,
  created_at: "2026-09-24T10:00:00+00:00",
  seq: 1,
  ...over,
});
const symbols = new Map([["i-voo", "VOO"]]);

/** Parsea el CSV como lo haría una planilla, sin la BOM. */
const parse = (csv: string) =>
  Papa.parse<string[]>(csv.replace(/^﻿/, ""), { skipEmptyLines: true }).data;

describe("csvText (defensa contra inyección de fórmulas)", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+54911", "'+54911"],
    ["-5 dólares", "'-5 dólares"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tinicio con tab", "'\tinicio con tab"],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
  ])("%j se neutraliza", (input, expected) => {
    expect(csvText(input)).toBe(expected);
  });

  it("el texto normal no se toca", () => {
    for (const text of [
      "VOO",
      "Comisión 30USD",
      "delta:2026-03-09|BUY|VOO|3|1725.72",
      "a-b",
      "x=1",
    ]) {
      expect(csvText(text)).toBe(text);
    }
  });

  it("entrecomilla lo que tiene coma, comillas o saltos de línea, y duplica las comillas", () => {
    expect(csvText("hola, mundo")).toBe('"hola, mundo"');
    expect(csvText('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvText("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
    expect(csvText("con\rretorno")).toBe('"con\rretorno"');
    expect(csvText(" espacios ")).toBe('" espacios "');
  });

  it("vacío y null valen cadena vacía", () => {
    expect(csvText(null)).toBe("");
    expect(csvText(undefined)).toBe("");
    expect(csvText("")).toBe("");
  });

  it("una fórmula con coma queda neutralizada Y entrecomillada", () => {
    expect(csvText('=HYPERLINK("http://x","clic")')).toBe(
      '"\'=HYPERLINK(""http://x"",""clic"")"',
    );
  });
});

describe("buildTransactionsCsv", () => {
  it("empieza con la BOM, usa CRLF y termina con salto de línea", () => {
    const csv = buildTransactionsCsv([], symbols);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe(`﻿${CSV_COLUMNS.join(",")}\r\n`);
  });

  it("una compra: números canónicos, fechas en UTC y en Montevideo, símbolo resuelto", () => {
    const [, data] = parse(buildTransactionsCsv([row()], symbols));
    expect(data).toEqual([
      "2026-03-09T22:34:00.000Z",
      "2026-03-09 19:34:00",
      "BUY",
      "VOO",
      "3",
      "575.24",
      "",
      "1",
      "",
      "USD",
      "",
      "manual",
      "",
    ]);
  });

  it("efectivo, dividendo y split", () => {
    const csv = buildTransactionsCsv(
      [
        row({
          type: "DEPOSIT",
          instrument_id: null,
          quantity: null,
          price: null,
          amount: "4200.0000",
          fee: "0.0000",
        }),
        row({
          type: "DIVIDEND",
          quantity: null,
          price: null,
          amount: "2.5000",
          fee: "0.0000",
        }),
        row({
          type: "SPLIT",
          quantity: null,
          price: null,
          split_ratio: "0.10000000",
          fee: "0.0000",
        }),
      ],
      symbols,
    );
    const rows = parse(csv).slice(1);
    expect(rows[0]).toMatchObject({ 2: "DEPOSIT", 3: "", 6: "4200", 7: "0" });
    expect(rows[1]).toMatchObject({ 2: "DIVIDEND", 3: "VOO", 6: "2.5" });
    expect(rows[2]).toMatchObject({ 2: "SPLIT", 8: "0.1" });
  });

  it("un interés negativo NO se altera (las columnas numéricas no se neutralizan)", () => {
    const csv = buildTransactionsCsv(
      [
        row({
          type: "INTEREST",
          instrument_id: null,
          quantity: null,
          price: null,
          amount: "-3.2500",
          fee: "0.0000",
        }),
      ],
      symbols,
    );
    expect(parse(csv)[1]?.[6]).toBe("-3.25");
  });

  it("las notas y el id externo con fórmulas o comas quedan seguros y se leen de vuelta", () => {
    const csv = buildTransactionsCsv(
      [
        row({ notes: "=1+1", external_id: "delta:x,y" }),
        row({ notes: 'Comisión "30USD", ver\nnota', external_id: "-5" }),
      ],
      symbols,
    );
    const [, first, second] = parse(csv);
    expect(first?.[10]).toBe("'=1+1");
    expect(first?.[12]).toBe("delta:x,y");
    expect(second?.[10]).toBe('Comisión "30USD", ver\nnota');
    expect(second?.[12]).toBe("'-5");
    expect(first).toHaveLength(CSV_COLUMNS.length);
  });

  it("un instrumento que no está en el mapa deja el símbolo vacío en vez de romper", () => {
    expect(
      parse(
        buildTransactionsCsv([row({ instrument_id: "desconocido" })], symbols),
      )[1]?.[3],
    ).toBe("");
  });

  it("no pierde precisión en cantidades y precios de 8 decimales", () => {
    const [, data] = parse(
      buildTransactionsCsv(
        [row({ quantity: "0.12345678", price: "1234.56789012" })],
        symbols,
      ),
    );
    expect(data?.[4]).toBe("0.12345678");
    expect(data?.[5]).toBe("1234.56789012");
  });

  it("el CSV del fixture completo: una fila por operación, todas con el mismo número de columnas", () => {
    const rows = fixtureRows();
    const ids = new Map(fixtureInstruments().map((i) => [i.id, i.symbol]));
    const table = parse(buildTransactionsCsv(rows, ids));
    expect(table).toHaveLength(rows.length + 1);
    for (const line of table) expect(line).toHaveLength(CSV_COLUMNS.length);
    expect(table.slice(1).filter((l) => l[2] === "BUY").length).toBe(
      rows.filter((r) => r.type === "BUY").length,
    );
    // Sin fórmulas sueltas en ninguna celda de texto.
    for (const line of table.slice(1)) {
      for (const i of [3, 9, 10, 11, 12])
        expect(line[i], `${line[12]} col ${i}`).not.toMatch(/^[=+\-@]/);
    }
  });
});
