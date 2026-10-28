import { describe, expect, it } from "vitest";
import {
  normalizeHeader,
  parseImportDate,
  parseSimpleCsv,
  resolveColumns,
} from "../simple";
import type { ImportParseResult } from "../types";

const NOW = new Date("2026-09-25T12:00:00Z");
const HEADER = "fecha,tipo,simbolo,cantidad,precio,monto,comision,notas";
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");
const parse = (text: string) => parseSimpleCsv(text, NOW);

/** Una sola fila válida de compra, con lo que se quiera cambiar. */
const buy = (cells: Partial<Record<string, string>> = {}) => {
  const c = {
    fecha: "2026-03-09",
    tipo: "compra",
    simbolo: "VOO",
    cantidad: "3",
    precio: "575.24",
    monto: "",
    comision: "1",
    notas: "",
    ...cells,
  };
  return [
    c.fecha,
    c.tipo,
    c.simbolo,
    c.cantidad,
    c.precio,
    c.monto,
    c.comision,
    c.notas,
  ].join(",");
};

const only = (r: ImportParseResult) => {
  expect(r.errors).toEqual([]);
  expect(r.fatal).toBeNull();
  expect(r.transactions).toHaveLength(1);
  return r.transactions[0]!;
};

describe("encabezados", () => {
  it.each([
    ["Símbolo", "simbolo"],
    ["  Precio (USD) ", "precio_usd"],
    ["Comisión (USD)", "comision_usd"],
    ["FECHA", "fecha"],
    ["razon-split", "razon_split"],
    ["Razón del split", "razon_del_split"],
  ])("%j se reconoce como %j", (raw, expected) => {
    expect(normalizeHeader(raw)).toBe(expected);
  });

  it("acepta alias en español e inglés, con tildes y mayúsculas", () => {
    const text = [
      "Date;Type;Ticker;Quantity;Price (USD);Fee;Notes",
      "2026-03-09;BUY;VOO;3;575.24;1;primera",
    ].join("\n");
    const tx = only(parse(text));
    expect(tx).toMatchObject({
      type: "BUY",
      symbol: "VOO",
      notes: "primera",
    });
    expect("quantity" in tx && tx.quantity.toFixed()).toBe("3");
    expect("price" in tx && tx.price.toFixed()).toBe("575.24");
    expect("fee" in tx && tx.fee.toFixed()).toBe("1");
  });

  it("con fecha_utc y fecha_montevideo (el export propio) gana el instante exacto", () => {
    const map = resolveColumns(["fecha_montevideo", "fecha_utc", "tipo"]);
    expect(map.date).toBe("fecha_utc");
    const text = [
      "fecha_utc,fecha_montevideo,tipo,simbolo,cantidad,precio",
      "2026-03-09T22:34:00.000Z,2026-03-09 19:34:00,BUY,VOO,3,575.24",
    ].join("\n");
    expect(only(parse(text)).executedAt.toISOString()).toBe(
      "2026-03-09T22:34:00.000Z",
    );
  });

  it("si vienen fecha_utc y fecha, gana fecha_utc (el instante exacto)", () => {
    const text = [
      "fecha,fecha_utc,tipo,simbolo,cantidad,precio",
      "2026-03-09,2026-03-10T21:00:00.000Z,compra,VOO,3,600",
    ].join("\n");
    expect(only(parse(text)).executedAt.toISOString()).toBe(
      "2026-03-10T21:00:00.000Z",
    );
  });

  it("ignora las columnas que no conoce", () => {
    const text = [
      `${HEADER},origen,id_externo,moneda`,
      `${buy()},manual,abc,USD`,
    ].join("\n");
    only(parse(text));
  });

  it("sin fecha o sin tipo es un error del archivo, y dice qué encontró", () => {
    const r = parse("simbolo,cantidad,precio\nVOO,3,600");
    expect(r.fatal).toMatchObject({ code: "MISSING_COLUMNS" });
    expect(r.fatal?.message).toContain("fecha, tipo");
    expect(r.fatal?.message).toContain("simbolo, cantidad, precio");
    expect(r.transactions).toEqual([]);
  });

  it("un archivo vacío es un error del archivo", () => {
    expect(parse("").fatal?.code).toBe("EMPTY_FILE");
    expect(parse("  \n \n").fatal?.code).toBe("EMPTY_FILE");
  });
});

describe("delimitadores y formato del archivo", () => {
  const rows = [
    "2026-03-09;compra;VOO;3;575,24;;1;",
    "2026-03-10;retiro;;;;50,5;;",
  ];

  it("punto y coma con coma decimal (Excel en español)", () => {
    const r = parse(
      ["fecha;tipo;simbolo;cantidad;precio;monto;comision;notas", ...rows].join(
        "\n",
      ),
    );
    expect(r.errors).toEqual([]);
    const [trade, withdrawal] = r.transactions;
    expect(trade && "price" in trade && trade.price.toFixed()).toBe("575.24");
    expect(
      withdrawal && "amount" in withdrawal && withdrawal.amount.toFixed(),
    ).toBe("50.5");
  });

  it("tabulaciones (filas copiadas de Google Sheets o Excel)", () => {
    const tsv = [
      "fecha\ttipo\tsimbolo\tcantidad\tprecio\tmonto\tcomision\tnotas",
      "09/03/2026\tcompra\tVOO\t3\t575,24\t\t1\t",
    ].join("\n");
    const tx = only(parse(tsv));
    expect("price" in tx && tx.price.toFixed()).toBe("575.24");
  });

  it("coma decimal entre comillas en un archivo separado por comas", () => {
    const tx = only(parse(file(buy({ precio: '"575,24"' }))));
    expect("price" in tx && tx.price.toFixed()).toBe("575.24");
  });

  it("coma decimal SIN comillas en un archivo separado por comas: error claro, no números corridos", () => {
    const r = parse(file("2026-03-09,compra,VOO,3,575,24,,1,"));
    expect(r.transactions).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 2, code: "MALFORMED_ROW" });
    expect(r.errors[0]?.message).toContain("575.24");
  });

  it("BOM, CRLF y comillas en el encabezado", () => {
    const bom = String.fromCharCode(0xfeff);
    const text = `${bom}"fecha","tipo","simbolo","cantidad","precio"\r\n"2026-03-09","compra","VOO","3","600"\r\n`;
    only(parse(text));
  });

  it("las filas vacías se saltean sin correr el número de fila", () => {
    const r = parse(file(buy(), "", ",,,,,,,", buy({ simbolo: "X Y Z!" })));
    expect(r.stats.rowsTotal).toBe(2);
    expect(r.transactions.map((t) => t.sourceRow)).toEqual([2]);
    expect(r.errors.map((e) => e.row)).toEqual([5]);
  });

  it("una fila con menos columnas se lee y reclama lo que falta, con su nombre", () => {
    const r = parse(file("2026-03-09,compra,VOO,3"));
    expect(r.errors.map((e) => e.code)).toEqual(["INVALID_PRICE"]);
    expect(r.errors[0]?.message).toBe("Precio: falta el dato");
  });

  it("las notas con comas van entre comillas y no rompen la fila", () => {
    const tx = only(parse(file(buy({ notas: '"primera, con coma"' }))));
    expect(tx.notes).toBe("primera, con coma");
  });

  it("las notas que el export dejó neutralizadas (`'=…`) se restauran", () => {
    const tx = only(parse(file(buy({ notas: "'=SUMA(A1)" }))));
    expect(tx.notes).toBe("=SUMA(A1)");
    const plain = only(parse(file(buy({ notas: "'no es fórmula" }))));
    expect(plain.notes).toBe("'no es fórmula");
  });

  it("notas de más de 500 caracteres: error", () => {
    const r = parse(file(buy({ notas: "x".repeat(501) })));
    expect(r.errors.map((e) => e.message)).toEqual([
      "Notas: máximo 500 caracteres",
    ]);
  });
});

describe("fechas", () => {
  const ok = (text: string) => {
    const r = parseImportDate(text, NOW);
    if (!r.ok) throw new Error(r.message);
    return r.value.toISOString();
  };
  const bad = (text: string) => {
    const r = parseImportDate(text, NOW);
    if (r.ok) throw new Error(`se esperaba error para ${text}`);
    return r.message;
  };

  it("solo el día: mediodía de Montevideo", () => {
    expect(ok("2026-03-09")).toBe("2026-03-09T15:00:00.000Z");
    expect(ok("09/03/2026")).toBe("2026-03-09T15:00:00.000Z");
    expect(ok("9/3/2026")).toBe("2026-03-09T15:00:00.000Z");
    expect(ok("09-03-2026")).toBe("2026-03-09T15:00:00.000Z");
    expect(ok("09.03.2026")).toBe("2026-03-09T15:00:00.000Z");
  });

  it("con hora sin zona: hora de Montevideo (UTC−3)", () => {
    expect(ok("2026-03-09 14:30")).toBe("2026-03-09T17:30:00.000Z");
    expect(ok("2026-03-09T14:30:15")).toBe("2026-03-09T17:30:15.000Z");
    expect(ok("09/03/2026 14:30")).toBe("2026-03-09T17:30:00.000Z");
    expect(ok("09/03/2026 8:05")).toBe("2026-03-09T11:05:00.000Z");
  });

  it("los límites de la hora sí valen: 23:59:59", () => {
    expect(ok("2026-03-09 23:59:59")).toBe("2026-03-10T02:59:59.000Z");
    expect(ok("2026-03-09 23:30")).toBe("2026-03-10T02:30:00.000Z");
    expect(ok("2026-03-09T23:59:59Z")).toBe("2026-03-09T23:59:59.000Z");
    expect(ok("09/03/2026 00:00")).toBe("2026-03-09T03:00:00.000Z");
  });

  it("con zona: se respeta", () => {
    expect(ok("2026-03-09T22:34:00.000Z")).toBe("2026-03-09T22:34:00.000Z");
    expect(ok("2026-03-09T14:30:00-03:00")).toBe("2026-03-09T17:30:00.000Z");
    expect(ok("2026-03-09T14:30:00-0300")).toBe("2026-03-09T17:30:00.000Z");
    expect(ok("2026-03-09T14:30+01:00")).toBe("2026-03-09T13:30:00.000Z");
  });

  it("el día va antes que el mes: 03/04 es el 3 de abril", () => {
    expect(ok("03/04/2026")).toBe("2026-04-03T15:00:00.000Z");
  });

  it.each([
    "31/02/2026",
    "2026-02-30",
    "2026-13-01",
    "13/13/2026",
    "03/13/2026", // mes/día invertido: el mes 13 no existe
    "09/03/26", // año de dos dígitos
    "2026-03-09 25:00",
    "2026-03-09 12:61",
    "2026-03-09T14:30:00-03:00Z",
    "2026-02-30T10:00:00Z", // con zona: new Date lo corrige a 2 de marzo
    "2026-02-29T10:00:00Z",
    "2026-03-09T24:00:00Z", // con zona: new Date lo corrige al día siguiente
    "2026-03-09T12:60:00Z",
    "2026-03-09T12:00:60Z",
    "2026-03-09 24:00",
    "2026-03-09 12:60",
    "2026-03-09 12:00:60",
    "ayer",
    "2026-03",
    "46090", // fecha serial de Excel
  ])("%j no es una fecha válida", (text) => {
    expect(bad(text)).toContain("no es válida");
    expect(bad(text)).toContain("AAAA-MM-DD");
  });

  it("una fecha con día 29/02 de año bisiesto sí existe, la de un año común no", () => {
    expect(ok("29/02/2024")).toBe("2024-02-29T15:00:00.000Z");
    expect(bad("29/02/2025")).toContain("no es válida");
  });

  it("futura: error, y sugiere revisar día y mes", () => {
    expect(bad("2026-09-27")).toContain("es futura");
    expect(bad("2026-09-27")).toContain("al revés");
    expect(bad("09/12/2027")).toContain("es futura");
  });

  it("hoy sí; antes de 1990, no", () => {
    expect(ok("2026-09-25")).toBe("2026-09-25T15:00:00.000Z");
    expect(bad("1989-12-31")).toContain("demasiado antigua");
  });
});

describe("tipos", () => {
  const typeOf = (text: string) => {
    const cells =
      text === "split"
        ? "2026-03-09,split,VOO,,,,,"
        : `2026-03-09,${text},VOO,3,600,10,,`;
    const r = parse(`${HEADER},razon_split\n${cells},2`);
    return r.transactions[0]?.type ?? r.errors.map((e) => e.code);
  };

  it.each([
    ["compra", "BUY"],
    ["BUY", "BUY"],
    ["Comprar", "BUY"],
    ["venta", "SELL"],
    ["Sell", "SELL"],
    ["dividendo", "DIVIDEND"],
    ["Depósito", "DEPOSIT"],
    ["deposito", "DEPOSIT"],
    ["retiro", "WITHDRAWAL"],
    ["WITHDRAWAL", "WITHDRAWAL"],
    ["Comisión", "FEE"],
    ["impuesto", "TAX"],
    ["Interés", "INTEREST"],
    ["split", "SPLIT"],
  ])("%j → %s", (text, expected) => {
    expect(typeOf(text)).toBe(expected);
  });

  it.each(["regalo", "", "b", "constructor", "__proto__", "toString"])(
    "%j no es un tipo",
    (text) => {
      const r = parse(file(buy({ tipo: text })));
      expect(r.transactions).toEqual([]);
      expect(r.errors.map((e) => e.code)).toEqual(["INVALID_TYPE"]);
      expect(r.errors[0]?.message).toContain("compra, venta");
    },
  );
});

describe("campos por tipo", () => {
  it("compra: símbolo, cantidad y precio obligatorios; comisión opcional (0)", () => {
    const tx = only(parse(file(buy({ comision: "" }))));
    expect(tx).toMatchObject({
      type: "BUY",
      symbol: "VOO",
      currency: "USD",
      source: "csv",
      sourceRow: 2,
    });
    expect("fee" in tx && tx.fee.toFixed()).toBe("0");
  });

  it("todos los problemas de una fila salen juntos", () => {
    const r = parse(file(buy({ simbolo: "", cantidad: "", precio: "abc" })));
    expect(r.errors.map((e) => e.code)).toEqual([
      "INVALID_SYMBOL",
      "INVALID_QUANTITY",
      "INVALID_PRICE",
    ]);
    expect(r.errors.every((e) => e.row === 2)).toBe(true);
    expect(r.errors[2]?.message).toContain("«abc»");
  });

  it("cantidad 0 o negativa, precio negativo, comisión negativa: error; precio 0 sí", () => {
    expect(parse(file(buy({ cantidad: "0" }))).errors[0]?.code).toBe(
      "INVALID_QUANTITY",
    );
    expect(parse(file(buy({ cantidad: "-1" }))).errors[0]?.code).toBe(
      "INVALID_QUANTITY",
    );
    expect(parse(file(buy({ precio: "-5" }))).errors[0]?.code).toBe(
      "INVALID_PRICE",
    );
    expect(parse(file(buy({ comision: "-1" }))).errors[0]?.code).toBe(
      "INVALID_FEE",
    );
    only(parse(file(buy({ precio: "0" }))));
  });

  it("límites de dígitos (los mismos que el formulario manual)", () => {
    expect(
      parse(file(buy({ cantidad: "12345678" }))).errors[0]?.message,
    ).toContain("Máximo 7 dígitos enteros");
    expect(
      parse(file(buy({ precio: "1.123456789" }))).errors[0]?.message,
    ).toContain("8 decimales");
    only(
      parse(file(buy({ cantidad: "0.12345678", precio: "1234567.12345678" }))),
    );
  });

  it("dos separadores (1.234,56) se rechazan: no se adivina si es de miles", () => {
    const r = parse(file(buy({ precio: '"1.234,56"' })));
    expect(r.errors[0]?.message).toContain("un solo separador decimal");
  });

  it("símbolos: se normalizan (brk.b → BRK-B); los inválidos se rechazan", () => {
    expect(only(parse(file(buy({ simbolo: "brk.b" })))).symbol).toBe("BRK-B");
    for (const simbolo of ["VOO (Vanguard)", "V$O", "A".repeat(16), ""]) {
      expect(parse(file(buy({ simbolo }))).errors[0]?.code).toBe(
        "INVALID_SYMBOL",
      );
    }
  });

  it("depósito, retiro, comisión e impuesto: solo monto positivo; el símbolo se ignora", () => {
    for (const tipo of ["deposito", "retiro", "comision", "impuesto"]) {
      const tx = only(parse(file(`2026-03-09,${tipo},VOO,,,100.5,,nota`)));
      expect(tx).toMatchObject({ symbol: null, notes: "nota" });
      expect("amount" in tx && tx.amount.toFixed()).toBe("100.5");
    }
    const sinMonto = parse(file("2026-03-09,deposito,,,,,,"));
    expect(sinMonto.errors.map((e) => e.message)).toEqual([
      "Monto: falta el dato",
    ]);
    expect(parse(file("2026-03-09,deposito,,,,-5,,")).errors[0]?.code).toBe(
      "INVALID_AMOUNT",
    );
  });

  it("interés: admite negativo (interés de margen), no cero", () => {
    const tx = only(parse(file("2026-03-09,interes,,,,-3.2,,")));
    expect("amount" in tx && tx.amount.toFixed()).toBe("-3.2");
    expect(parse(file("2026-03-09,interes,,,,0,,")).errors[0]?.code).toBe(
      "INVALID_AMOUNT",
    );
  });

  it("dividendo: el monto es positivo", () => {
    for (const monto of ["-1.15", "0"]) {
      expect(
        parse(file(`2026-03-09,dividendo,VOO,,,${monto},,`)).errors[0]?.code,
      ).toBe("INVALID_AMOUNT");
    }
  });

  it("dividendo: símbolo y monto", () => {
    const tx = only(parse(file("2026-03-09,dividendo,VOO,,,1.15,,")));
    expect(tx).toMatchObject({ type: "DIVIDEND", symbol: "VOO" });
    expect(parse(file("2026-03-09,dividendo,,,,1.15,,")).errors[0]?.code).toBe(
      "INVALID_SYMBOL",
    );
  });

  it("split: razón positiva y distinta de 1 (10 = 10:1, 0.1 = inverso 1:10)", () => {
    const withRatio = (ratio: string) =>
      parse(`${HEADER},razon_split\n2026-03-09,split,VOO,,,,,,${ratio}`);
    const ten = only(withRatio("10"));
    expect("splitRatio" in ten && ten.splitRatio.toFixed()).toBe("10");
    const inverse = only(withRatio('"0,1"'));
    expect("splitRatio" in inverse && inverse.splitRatio.toFixed()).toBe("0.1");
    expect(withRatio("1").errors.map((e) => e.code)).toEqual(["INVALID_SPLIT"]);
    expect(withRatio("").errors[0]?.message).toBe(
      "Razón del split: falta el dato",
    );
    expect(withRatio("0").errors[0]?.code).toBe("INVALID_SPLIT");
  });

  it("moneda: USD entra; otra se ignora con su motivo", () => {
    const withCurrency = (moneda: string) =>
      parse(`${HEADER},moneda\n${buy()},${moneda}`);
    only(withCurrency("USD"));
    only(withCurrency("usd"));
    const uyu = withCurrency("UYU");
    expect(uyu.transactions).toEqual([]);
    expect(uyu.skipped).toEqual([
      expect.objectContaining({ row: 2, reason: "UNSUPPORTED_CURRENCY" }),
    ]);
  });
});

describe("instrumentos y orden", () => {
  it("lista los símbolos una sola vez, sin nombre ni tipo conocidos", () => {
    const r = parse(
      file(
        buy({ simbolo: "VOO" }),
        buy({ simbolo: "AAPL" }),
        buy({ simbolo: "VOO", fecha: "2026-03-10" }),
        "2026-03-09,deposito,,,,100,,",
      ),
    );
    expect(r.instruments.map((i) => i.symbol).sort()).toEqual(["AAPL", "VOO"]);
    expect(r.instruments.every((i) => i.name === null)).toBe(true);
  });

  it("ordena por fecha y conserva el orden del archivo dentro del mismo día", () => {
    const r = parse(
      file(
        buy({ fecha: "2026-03-10", simbolo: "C" }),
        buy({ fecha: "2026-03-09", simbolo: "A" }),
        buy({ fecha: "2026-03-09", simbolo: "B" }),
        "2026-03-09,deposito,,,,100,,",
      ),
    );
    expect(r.transactions.map((t) => t.sourceRow)).toEqual([3, 4, 5, 2]);
  });
});

describe("clave de deduplicación", () => {
  it("es la misma al volver a leer el mismo archivo", () => {
    const text = file(buy(), "2026-03-09,deposito,,,,100,,");
    expect(parse(text).transactions.map((t) => t.externalId)).toEqual(
      parse(text).transactions.map((t) => t.externalId),
    );
  });

  it("no depende de cómo se escriben los números (600 = 600,00 = 600.0)", () => {
    const ids = ["600", "600.00", '"600,0"'].map(
      (precio) => only(parse(file(buy({ precio })))).externalId,
    );
    expect(new Set(ids).size).toBe(1);
  });

  it("no depende del formato de la fecha, sí del instante", () => {
    const a = only(parse(file(buy({ fecha: "2026-03-09" })))).externalId;
    const b = only(parse(file(buy({ fecha: "09/03/2026" })))).externalId;
    const c = only(parse(file(buy({ fecha: "09/03/2026 13:00" })))).externalId;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("cambia si cambia cualquier dato de la operación", () => {
    const base = only(parse(file(buy()))).externalId;
    for (const change of [
      { cantidad: "4" },
      { precio: "612.77" },
      { comision: "2" },
      { simbolo: "IVV" },
      { tipo: "venta" },
      { fecha: "2026-03-10" },
    ]) {
      expect(only(parse(file(buy(change)))).externalId).not.toBe(base);
    }
  });

  it("las notas no forman parte de la clave", () => {
    const a = only(parse(file(buy({ notas: "uno" })))).externalId;
    const b = only(parse(file(buy({ notas: "otro" })))).externalId;
    expect(a).toBe(b);
  });

  it("las filas idénticas del mismo archivo llevan sufijo #2, #3…", () => {
    const r = parse(file(buy(), buy(), buy()));
    const ids = r.transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBe(`${ids[0]}#2`);
    expect(ids[2]).toBe(`${ids[0]}#3`);
  });

  it("empieza con csv: (no se mezcla con los ids de Delta)", () => {
    expect(only(parse(file(buy()))).externalId.startsWith("csv:")).toBe(true);
  });
});

describe("estadísticas", () => {
  it("cuenta filas, importadas, ignoradas y con error", () => {
    const r = parse(
      `${HEADER},moneda\n${buy()},USD\n${buy()},UYU\n${buy({ cantidad: "x" })},USD\n`,
    );
    expect(r.stats).toEqual({
      rowsTotal: 3,
      imported: 1,
      skipped: 1,
      errors: 1,
    });
  });
});
