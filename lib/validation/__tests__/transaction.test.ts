import { describe, expect, it } from "vitest";
import {
  normalizeSymbol,
  parseDecimalText,
  parseTransactionForm,
  splitRatio,
  type RawTransactionForm,
  type TransactionInput,
} from "../transaction";
import { d } from "@/lib/engine";

// "Ahora" = 2026-09-24 15:00 en Montevideo (18:00 UTC).
const NOW = new Date("2026-09-24T18:00:00Z");

const form = (fields: RawTransactionForm) => parseTransactionForm(fields, NOW);
const valid = (fields: RawTransactionForm): TransactionInput => {
  const result = form(fields);
  if (!result.ok)
    throw new Error(`esperaba válido: ${JSON.stringify(result.errors)}`);
  return result.data;
};
const errorsOf = (fields: RawTransactionForm) => {
  const result = form(fields);
  if (result.ok) throw new Error("esperaba errores");
  return result.errors;
};

const buyForm = (over: RawTransactionForm = {}): RawTransactionForm => ({
  type: "BUY",
  symbol: "VOO",
  quantity: "8,95",
  price: "662,4",
  fee: "1",
  executedAt: "2026-09-23T10:00",
  ...over,
});

describe("parseDecimalText", () => {
  const rules = { maxInt: 7, maxDecimals: 8, rule: "positive" } as const;
  const ok = (
    raw: string,
    r: Parameters<typeof parseDecimalText>[1] = rules,
  ) => {
    const parsed = parseDecimalText(raw, r);
    if (!parsed.ok) throw new Error(`${raw}: ${parsed.message}`);
    return parsed.value.toFixed();
  };
  const message = (
    raw: string,
    r: Parameters<typeof parseDecimalText>[1] = rules,
  ) => {
    const parsed = parseDecimalText(raw, r);
    if (parsed.ok) throw new Error(`${raw} debería fallar`);
    return parsed.message;
  };

  it("acepta coma o punto decimal y espacios alrededor", () => {
    expect(ok("12,5")).toBe("12.5");
    expect(ok("12.5")).toBe("12.5");
    expect(ok("  251.41 ")).toBe("251.41");
    expect(ok("3")).toBe("3");
    expect(ok("0,00000001")).toBe("1e-8".length ? "0.00000001" : "");
    expect(ok("1234567,12345678")).toBe("1234567.12345678");
  });

  it("no pierde precisión: 251,41 es exactamente 251.41", () => {
    const parsed = parseDecimalText("251,41", rules);
    expect(parsed.ok && parsed.value.eq(d("251.41"))).toBe(true);
  });

  it.each([
    ["", /Escribí un número/],
    ["   ", /Escribí un número/],
    ["abc", /Escribí un número/],
    ["1e5", /Escribí un número/],
    ["0x10", /Escribí un número/],
    ["+5", /Escribí un número/],
    ["5 000", /Escribí un número/],
    ["1_000", /Escribí un número/],
    [".5", /Escribí un número/],
    ["5.", /Escribí un número/],
    ["١٢٣", /Escribí un número/], // dígitos arábigos
    ["１２３", /Escribí un número/], // dígitos de ancho completo
    ["NaN", /Escribí un número/],
    ["Infinity", /Escribí un número/],
  ])("formato inválido %j", (raw, expected) => {
    expect(message(raw)).toMatch(expected);
  });

  it("dos separadores (miles y decimales) se rechazan en vez de adivinar", () => {
    expect(message("1.234,56")).toMatch(/un solo separador/);
    expect(message("1,234.56")).toMatch(/un solo separador/);
    expect(message("1,2,3")).toMatch(/un solo separador/);
    expect(message("1..2")).toMatch(/un solo separador/);
  });

  it("límites de dígitos con un mensaje específico", () => {
    expect(message("12345678")).toMatch(
      /Máximo 7 dígitos enteros y 8 decimales/,
    );
    expect(message("1,123456789")).toMatch(
      /Máximo 7 dígitos enteros y 8 decimales/,
    );
    expect(ok("9999999,99999999")).toBe("9999999.99999999");
  });

  it("reglas de signo", () => {
    expect(message("0")).toMatch(/mayor que 0/);
    expect(message("-5")).toMatch(/mayor que 0/);
    expect(ok("0", { ...rules, rule: "nonNegative" })).toBe("0");
    expect(message("-1", { ...rules, rule: "nonNegative" })).toMatch(
      /No puede ser negativo/,
    );
    expect(ok("-3,25", { ...rules, rule: "nonZero" })).toBe("-3.25");
    expect(ok("3,25", { ...rules, rule: "nonZero" })).toBe("3.25");
    expect(message("0", { ...rules, rule: "nonZero" })).toMatch(
      /No puede ser 0/,
    );
    expect(message("-0", { ...rules, rule: "nonZero" })).toMatch(
      /No puede ser 0/,
    );
  });
});

describe("normalizeSymbol", () => {
  it.each([
    ["voo", "VOO"],
    ["  Voo ", "VOO"],
    ["brk.b", "BRK-B"],
    ["BRK B", "BRK-B"],
    ["brk-b", "BRK-B"],
    ["aapl", "AAPL"],
  ])("%j → %s", (input, expected) => {
    expect(normalizeSymbol(input)).toBe(expected);
  });
});

describe("splitRatio", () => {
  it.each([
    ["10", "1", "10"],
    ["1", "10", "0.1"],
    ["3", "2", "1.5"],
    ["1", "3", "0.33333333"],
    ["2", "1", "2"],
  ])("%s por %s → %s", (n, o, expected) => {
    expect(splitRatio(d(n), d(o))?.toFixed()).toBe(expected);
  });

  it("una razón que redondea a cero es inválida", () => {
    expect(splitRatio(d("0.00000001"), d("9999999"))).toBeNull();
  });
});

describe("parseTransactionForm: compras y ventas", () => {
  it("BUY normal: símbolo en mayúsculas, montos exactos y fecha en hora de Montevideo", () => {
    const tx = valid(buyForm({ symbol: "voo" }));
    expect(tx).toMatchObject({ type: "BUY", symbol: "VOO", notes: null });
    if (tx.type !== "BUY") throw new Error();
    expect(tx.quantity.toFixed()).toBe("8.95");
    expect(tx.price.toFixed()).toBe("662.4");
    expect(tx.fee.toFixed()).toBe("1");
    expect(tx.executedAt.toISOString()).toBe("2026-09-23T13:00:00.000Z"); // 10:00 en Montevideo
  });

  it("la operación manual de la sección 8.3: BUY DDOG 2 @ 251,41 con comisión 1,00 el 23/09/2026", () => {
    const tx = valid({
      type: "BUY",
      symbol: "ddog",
      quantity: "2",
      price: "251,41",
      fee: "1,00",
      executedAt: "2026-09-23T12:00",
    });
    if (tx.type !== "BUY") throw new Error();
    expect(tx.symbol).toBe("DDOG");
    expect(tx.quantity.times(tx.price).plus(tx.fee).toFixed()).toBe("503.82"); // costo base esperado
  });

  it("la comisión vacía vale 0", () => {
    const tx = valid(buyForm({ fee: "" }));
    if (tx.type !== "BUY") throw new Error();
    expect(tx.fee.toFixed()).toBe("0");
    const missing = valid({ ...buyForm(), fee: undefined });
    expect(missing).toMatchObject({ type: "BUY" });
  });

  it("SELL", () => {
    expect(valid(buyForm({ type: "SELL" }))).toMatchObject({
      type: "SELL",
      symbol: "VOO",
    });
  });

  it("clase de acciones con punto o espacio: BRK.B → BRK-B", () => {
    expect(valid(buyForm({ symbol: "brk.b" }))).toMatchObject({
      symbol: "BRK-B",
    });
  });

  it("precio 0 es válido (acciones regaladas); cantidad 0 no", () => {
    expect(valid(buyForm({ price: "0" }))).toMatchObject({ type: "BUY" });
    expect(errorsOf(buyForm({ quantity: "0" })).quantity).toMatch(
      /mayor que 0/,
    );
  });

  it("errores por campo, todos a la vez", () => {
    const errors = errorsOf(
      buyForm({ symbol: "V@O", quantity: "abc", price: "-1", fee: "-2" }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      "fee",
      "price",
      "quantity",
      "symbol",
    ]);
    expect(errors.symbol).toMatch(/Símbolo inválido/);
    expect(errors.quantity).toMatch(/Escribí un número/);
    expect(errors.price).toMatch(/No puede ser negativo/);
  });

  it("símbolo vacío, demasiado largo o con caracteres raros", () => {
    expect(errorsOf(buyForm({ symbol: "" })).symbol).toBeDefined();
    expect(errorsOf(buyForm({ symbol: "   " })).symbol).toBeDefined();
    expect(errorsOf(buyForm({ symbol: "A".repeat(16) })).symbol).toMatch(
      /demasiado largo/,
    );
    for (const symbol of [
      "V/O",
      "VOO;",
      "<b>",
      "VOO\u0000",
      "^GSPC",
      "BTC=X",
      "voo-",
      "-voo",
    ]) {
      expect(errorsOf(buyForm({ symbol })).symbol, symbol).toBeDefined();
    }
  });
});

describe("parseTransactionForm: dividendos, splits y efectivo", () => {
  const base = { executedAt: "2026-06-26T10:00" };

  it("DIVIDEND", () => {
    const tx = valid({
      ...base,
      type: "DIVIDEND",
      symbol: "voo",
      amount: "1,962",
    });
    expect(tx).toMatchObject({ type: "DIVIDEND", symbol: "VOO" });
    if (tx.type !== "DIVIDEND") throw new Error();
    expect(tx.amount.toFixed()).toBe("1.962");
  });

  it("SPLIT: 'nuevas por cada viejas'", () => {
    const tx = valid({
      ...base,
      type: "SPLIT",
      symbol: "nvda",
      splitNew: "10",
      splitOld: "1",
    });
    expect(tx).toMatchObject({ type: "SPLIT", symbol: "NVDA" });
    if (tx.type !== "SPLIT") throw new Error();
    expect(tx.splitRatio.toFixed()).toBe("10");
    const reverse = valid({
      ...base,
      type: "SPLIT",
      symbol: "X",
      splitNew: "1",
      splitOld: "10",
    });
    if (reverse.type !== "SPLIT") throw new Error();
    expect(reverse.splitRatio.toFixed()).toBe("0.1");
  });

  it("SPLIT inválidos: 1 por 1, razón que redondea a 0 y valores no positivos", () => {
    expect(
      errorsOf({
        ...base,
        type: "SPLIT",
        symbol: "X",
        splitNew: "1",
        splitOld: "1",
      }).splitNew,
    ).toMatch(/1 por 1/);
    expect(
      errorsOf({
        ...base,
        type: "SPLIT",
        symbol: "X",
        splitNew: "0,00000001",
        splitOld: "9999999",
      }).splitNew,
    ).toMatch(/fuera de rango/);
    expect(
      errorsOf({
        ...base,
        type: "SPLIT",
        symbol: "X",
        splitNew: "0",
        splitOld: "1",
      }).splitNew,
    ).toMatch(/mayor que 0/);
    expect(
      errorsOf({
        ...base,
        type: "SPLIT",
        symbol: "X",
        splitNew: "2",
        splitOld: "",
      }).splitOld,
    ).toBeDefined();
  });

  it.each(["DEPOSIT", "WITHDRAWAL", "FEE", "TAX"] as const)(
    "%s: monto positivo y sin símbolo",
    (type) => {
      const tx = valid({ ...base, type, amount: "4200", symbol: "VOO" }); // el símbolo sobrante se ignora
      expect(tx).toMatchObject({ type, symbol: null });
      if (tx.type === "BUY" || tx.type === "SELL" || tx.type === "SPLIT")
        throw new Error();
      expect((tx as { amount: { toFixed(): string } }).amount.toFixed()).toBe(
        "4200",
      );
      expect(errorsOf({ ...base, type, amount: "0" }).amount).toMatch(
        /mayor que 0/,
      );
      expect(errorsOf({ ...base, type, amount: "-5" }).amount).toMatch(
        /mayor que 0/,
      );
      expect(errorsOf({ ...base, type, amount: "" }).amount).toBeDefined();
    },
  );

  it("INTEREST admite negativos (interés de margen) pero no cero", () => {
    const negative = valid({ ...base, type: "INTEREST", amount: "-3,25" });
    expect(negative).toMatchObject({ type: "INTEREST", symbol: null });
    expect(valid({ ...base, type: "INTEREST", amount: "0,10" })).toMatchObject({
      type: "INTEREST",
    });
    expect(errorsOf({ ...base, type: "INTEREST", amount: "0" }).amount).toMatch(
      /No puede ser 0/,
    );
  });

  it("los campos que no corresponden al tipo no se validan ni se devuelven", () => {
    const tx = valid({
      ...base,
      type: "DEPOSIT",
      amount: "100",
      quantity: "basura",
      price: "basura",
      splitNew: "x",
    });
    expect(Object.keys(tx).sort()).toEqual([
      "amount",
      "executedAt",
      "notes",
      "symbol",
      "type",
    ]);
  });
});

describe("parseTransactionForm: tipo, fecha y notas", () => {
  it("tipo ausente o desconocido", () => {
    expect(errorsOf({}).type).toMatch(/Elegí el tipo/);
    expect(errorsOf({ type: "HACK" }).type).toMatch(/Elegí el tipo/);
    expect(errorsOf({ type: "buy" }).type).toBeDefined(); // distingue mayúsculas
    expect(errorsOf({ type: "__proto__" }).type).toBeDefined();
  });

  it("fecha inválida o ausente", () => {
    expect(errorsOf(buyForm({ executedAt: "" })).executedAt).toBeDefined();
    expect(errorsOf(buyForm({ executedAt: undefined })).executedAt).toMatch(
      /Elegí la fecha/,
    );
    expect(errorsOf(buyForm({ executedAt: "mañana" })).executedAt).toMatch(
      /inválidas/,
    );
    expect(
      errorsOf(buyForm({ executedAt: "2026-02-31T10:00" })).executedAt,
    ).toMatch(/inválidas/);
  });

  it("no acepta fechas futuras (más de 24 h adelante) ni anteriores a 1990", () => {
    // Hoy 15:00 en Montevideo: dentro de 23 h pasa; dentro de 25 h, no.
    expect(form(buyForm({ executedAt: "2026-09-25T14:00" })).ok).toBe(true);
    expect(
      errorsOf(buyForm({ executedAt: "2026-09-25T16:00" })).executedAt,
    ).toMatch(/futura/);
    expect(
      errorsOf(buyForm({ executedAt: "2030-01-01T00:00" })).executedAt,
    ).toMatch(/futura/);
    expect(
      errorsOf(buyForm({ executedAt: "1989-12-30T10:00" })).executedAt,
    ).toMatch(/antigua/);
    expect(form(buyForm({ executedAt: "1990-01-02T10:00" })).ok).toBe(true);
  });

  it("notas: se limpian, se acotan y vacías valen null", () => {
    expect(
      valid(buyForm({ notes: "  Comisión\n 30USD \u0000 " })),
    ).toMatchObject({ notes: "Comisión 30USD" });
    expect(valid(buyForm({ notes: "" }))).toMatchObject({ notes: null });
    expect(valid(buyForm({ notes: "   " }))).toMatchObject({ notes: null });
    expect(valid(buyForm({ notes: "a".repeat(500) }))).toMatchObject({
      notes: "a".repeat(500),
    });
    expect(errorsOf(buyForm({ notes: "a".repeat(501) })).notes).toMatch(
      /Máximo 500/,
    );
    expect(errorsOf(buyForm({ notes: "a".repeat(3000) })).notes).toMatch(
      /Máximo 500/,
    );
  });

  it("los valores que no son texto (un archivo subido en el campo) cuentan como ausentes y no rompen", () => {
    const file = new File(["x"], "x.txt");
    const result = form({ ...buyForm(), quantity: file, symbol: file });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(["quantity", "symbol"]);
  });
});
