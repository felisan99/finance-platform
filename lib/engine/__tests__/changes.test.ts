import { describe, expect, it } from "vitest";
import { validateLedgerChange } from "../changes";
import { computeEngine } from "../engine";
import type { Transaction } from "../types";
import {
  buy,
  deepFreeze,
  deposit,
  dividend,
  expectDec,
  positionOf,
  sell,
  split,
  withdrawal,
} from "./helpers";

const T0 = "2026-01-05T15:00:00Z";
const T1 = "2026-01-06T15:00:00Z";
const T2 = "2026-01-07T15:00:00Z";
const T3 = "2026-01-08T15:00:00Z";

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("validateLedgerChange: alta", () => {
  it("una compra sobre un libro vacío es válida (efectivo negativo es solo advertencia)", () => {
    const check = validateLedgerChange([], {
      kind: "add",
      tx: buy(T0, "AAA", "10", "100"),
    });
    expect(check.ok).toBe(true);
    expect(check.newErrors).toEqual([]);
    expect(codes(check.newWarnings)).toEqual(["NEGATIVE_CASH"]);
    expectDec(positionOf(check.after, "AAA").quantity, "10");
  });

  it("una venta que excede lo que hay se rechaza y apunta a la transacción", () => {
    const existing = [deposit(T0, "5000"), buy(T0, "AAA", "10", "100")];
    const oversell = sell(T1, "AAA", "11", "120");
    const check = validateLedgerChange(existing, { kind: "add", tx: oversell });
    expect(check.ok).toBe(false);
    expect(check.newErrors).toHaveLength(1);
    expect(check.newErrors[0]).toMatchObject({
      code: "SELL_EXCEEDS_HOLDINGS",
      txId: oversell.id,
      symbol: "AAA",
    });
  });

  it("vender exactamente todo es válido", () => {
    const existing = [deposit(T0, "5000"), buy(T0, "AAA", "10", "100")];
    const check = validateLedgerChange(existing, {
      kind: "add",
      tx: sell(T1, "AAA", "10", "120"),
    });
    expect(check.ok).toBe(true);
    expect(positionOf(check.after, "AAA").isOpen).toBe(false);
  });

  it("una venta fechada ANTES de la compra es un error (el orden es por fecha, no por carga)", () => {
    const existing = [deposit(T0, "5000"), buy(T2, "AAA", "10", "100")];
    const check = validateLedgerChange(existing, {
      kind: "add",
      tx: sell(T1, "AAA", "5", "120"),
    });
    expect(check.ok).toBe(false);
    expect(codes(check.newErrors)).toEqual(["SELL_EXCEEDS_HOLDINGS"]);
  });

  it("una moneda no soportada se rechaza", () => {
    const eur = { ...deposit(T0, "100"), currency: "EUR" };
    const check = validateLedgerChange([], { kind: "add", tx: eur });
    expect(check.ok).toBe(false);
    expect(codes(check.newErrors)).toEqual(["UNSUPPORTED_CURRENCY"]);
  });

  it("dividendo y split sobre lo que se tiene: válidos y sin advertencias nuevas", () => {
    const existing = [deposit(T0, "5000"), buy(T0, "AAA", "10", "100")];
    expect(
      validateLedgerChange(existing, {
        kind: "add",
        tx: dividend(T1, "AAA", "5"),
      }).ok,
    ).toBe(true);
    const withSplit = validateLedgerChange(existing, {
      kind: "add",
      tx: split(T1, "AAA", "2"),
    });
    expect(withSplit.ok).toBe(true);
    expectDec(positionOf(withSplit.after, "AAA").quantity, "20");
  });

  it("un split de algo que no se tiene es solo una advertencia", () => {
    const check = validateLedgerChange([deposit(T0, "100")], {
      kind: "add",
      tx: split(T1, "AAA", "2"),
    });
    expect(check.ok).toBe(true);
    expect(codes(check.newWarnings)).toContain("SPLIT_WITHOUT_POSITION");
  });

  it("un split anterior habilita vender más acciones que las compradas", () => {
    const existing = [
      deposit(T0, "5000"),
      buy(T0, "AAA", "10", "100"),
      split(T1, "AAA", "2"),
    ];
    expect(
      validateLedgerChange(existing, {
        kind: "add",
        tx: sell(T2, "AAA", "20", "60"),
      }).ok,
    ).toBe(true);
    expect(
      validateLedgerChange(existing, {
        kind: "add",
        tx: sell(T2, "AAA", "21", "60"),
      }).ok,
    ).toBe(false);
  });
});

describe("validateLedgerChange: varias altas juntas (importación)", () => {
  it("se valida el conjunto: una venta que se apoya en una compra del mismo lote es válida", () => {
    const check = validateLedgerChange([], {
      kind: "addMany",
      txs: [
        deposit(T0, "5000"),
        buy(T0, "AAA", "10", "100"),
        sell(T1, "AAA", "10", "120"),
      ],
    });
    expect(check.ok).toBe(true);
    expectDec(check.after.cash, "5200");
  });

  it("un error dentro del lote lo rechaza entero", () => {
    const oversell = sell(T1, "AAA", "11", "120");
    const check = validateLedgerChange([], {
      kind: "addMany",
      txs: [deposit(T0, "5000"), buy(T0, "AAA", "10", "100"), oversell],
    });
    expect(check.ok).toBe(false);
    expect(check.newErrors[0]).toMatchObject({
      code: "SELL_EXCEEDS_HOLDINGS",
      txId: oversell.id,
    });
  });

  it("un lote vacío no cambia nada", () => {
    const existing = [deposit(T0, "100")];
    const check = validateLedgerChange(existing, { kind: "addMany", txs: [] });
    expect(check.ok).toBe(true);
    expectDec(check.after.cash, "100");
  });

  it("las nuevas se mezclan por fecha con las existentes", () => {
    // La compra ya existe con fecha T2; el lote trae una venta de T3 (válida) y otra de T1 (antes de comprar).
    const existing = [deposit(T0, "5000"), buy(T2, "AAA", "10", "100")];
    expect(
      validateLedgerChange(existing, {
        kind: "addMany",
        txs: [sell(T3, "AAA", "10", "110")],
      }).ok,
    ).toBe(true);
    expect(
      validateLedgerChange(existing, {
        kind: "addMany",
        txs: [sell(T1, "AAA", "10", "110")],
      }).ok,
    ).toBe(false);
  });
});

describe("validateLedgerChange: baja", () => {
  it("borrar la compra que sostiene una venta posterior se rechaza y apunta a la venta", () => {
    const funding = deposit(T0, "5000");
    const purchase = buy(T0, "AAA", "10", "100");
    const sale = sell(T2, "AAA", "10", "120");
    const check = validateLedgerChange([funding, purchase, sale], {
      kind: "remove",
      id: purchase.id,
    });
    expect(check.ok).toBe(false);
    expect(check.newErrors[0]).toMatchObject({
      code: "SELL_EXCEEDS_HOLDINGS",
      txId: sale.id,
    });
  });

  it("borrar una compra que no sostiene nada es válido", () => {
    const funding = deposit(T0, "5000");
    const lone = buy(T0, "BBB", "3", "20");
    const check = validateLedgerChange(
      [funding, buy(T0, "AAA", "10", "100"), lone],
      {
        kind: "remove",
        id: lone.id,
      },
    );
    expect(check.ok).toBe(true);
    expect(check.after.positions.map((p) => p.symbol)).toEqual(["AAA"]);
  });

  it("borrar el depósito que fondea una compra: se permite pero avisa del efectivo negativo", () => {
    const funding = deposit(T0, "5000");
    const check = validateLedgerChange([funding, buy(T1, "AAA", "10", "100")], {
      kind: "remove",
      id: funding.id,
    });
    expect(check.ok).toBe(true);
    expect(check.newErrors).toEqual([]);
    expect(codes(check.newWarnings)).toEqual(["NEGATIVE_CASH"]);
  });

  it("borrar la única transacción deja un libro vacío", () => {
    const only = deposit(T0, "100");
    const check = validateLedgerChange([only], { kind: "remove", id: only.id });
    expect(check.ok).toBe(true);
    expect(check.after.positions).toEqual([]);
    expectDec(check.after.cash, "0");
  });
});

describe("validateLedgerChange: edición", () => {
  const funding = deposit(T0, "5000");
  const purchase = buy(T0, "AAA", "10", "100");
  const sale = sell(T2, "AAA", "10", "120");
  const ledger: Transaction[] = [funding, purchase, sale];

  it("cambiar la comisión o el precio es válido", () => {
    const edited = { ...purchase, price: purchase.price.plus(1) };
    const check = validateLedgerChange(ledger, {
      kind: "replace",
      id: purchase.id,
      tx: edited,
    });
    expect(check.ok).toBe(true);
  });

  it("bajar la cantidad de la compra por debajo de lo vendido se rechaza", () => {
    const edited = { ...purchase, quantity: purchase.quantity.minus(1) };
    const check = validateLedgerChange(ledger, {
      kind: "replace",
      id: purchase.id,
      tx: edited,
    });
    expect(check.ok).toBe(false);
    expect(check.newErrors[0]).toMatchObject({
      code: "SELL_EXCEEDS_HOLDINGS",
      txId: sale.id,
    });
  });

  it("subir la cantidad vendida por encima de lo comprado se rechaza (el error es de la propia venta)", () => {
    const edited = { ...sale, quantity: sale.quantity.plus(1) };
    const check = validateLedgerChange(ledger, {
      kind: "replace",
      id: sale.id,
      tx: edited,
    });
    expect(check.ok).toBe(false);
    expect(check.newErrors[0]).toMatchObject({
      code: "SELL_EXCEEDS_HOLDINGS",
      txId: sale.id,
    });
  });

  it("mover la venta a una fecha anterior a la compra se rechaza", () => {
    const edited = {
      ...sale,
      executedAt: new Date("2026-01-04T15:00:00Z"),
      createdAt: new Date("2026-01-04T15:00:00Z"),
    };
    expect(
      validateLedgerChange(ledger, { kind: "replace", id: sale.id, tx: edited })
        .ok,
    ).toBe(false);
  });

  it("reemplazar el depósito por un retiro: se permite pero avisa del efectivo negativo", () => {
    // Efectivo final: −5000 − 1000 (compra) + 1200 (venta) = −4800.
    const asWithdrawal = { ...withdrawal(T1, "5000"), id: funding.id };
    const check = validateLedgerChange(ledger, {
      kind: "replace",
      id: funding.id,
      tx: asWithdrawal,
    });
    expect(check.ok).toBe(true);
    expect(codes(check.newWarnings)).toContain("NEGATIVE_CASH");
  });
});

describe("validateLedgerChange: libros que ya tenían problemas", () => {
  it("un error que ya existía no bloquea un cambio ajeno", () => {
    const bad = sell(T0, "AAA", "5", "100"); // vender sin tener: error preexistente
    const existing = [deposit(T0, "1000"), bad];
    expect(
      computeEngine(existing).issues.some((i) => i.severity === "error"),
    ).toBe(true);
    const check = validateLedgerChange(existing, {
      kind: "add",
      tx: deposit(T1, "50"),
    });
    expect(check.ok).toBe(true);
    expect(check.newErrors).toEqual([]);
  });

  it("pero un error NUEVO sobre ese mismo libro sí se rechaza", () => {
    const existing = [deposit(T0, "1000"), sell(T0, "AAA", "5", "100")];
    const check = validateLedgerChange(existing, {
      kind: "add",
      tx: sell(T1, "BBB", "1", "10"),
    });
    expect(check.ok).toBe(false);
    expect(check.newErrors).toHaveLength(1);
    expect(check.newErrors[0]).toMatchObject({ symbol: "BBB" });
  });

  it("editar la venta errónea manteniéndola errónea no cuenta como error nuevo", () => {
    const bad = sell(T0, "AAA", "5", "100");
    const check = validateLedgerChange([deposit(T0, "1000"), bad], {
      kind: "replace",
      id: bad.id,
      tx: { ...bad, quantity: bad.quantity.plus(1) },
    });
    expect(check.ok).toBe(true);
  });

  it("una advertencia que ya existía no se informa como nueva", () => {
    const existing = [buy(T0, "AAA", "1", "10")]; // efectivo negativo desde el principio
    const check = validateLedgerChange(existing, {
      kind: "add",
      tx: buy(T1, "AAA", "1", "10"),
    });
    expect(check.newWarnings).toEqual([]);
  });
});

describe("validateLedgerChange: uso", () => {
  it("no muta las transacciones recibidas", () => {
    const existing = deepFreeze([
      deposit(T0, "5000"),
      buy(T0, "AAA", "10", "100"),
    ]);
    const before = existing.length;
    validateLedgerChange(existing, {
      kind: "add",
      tx: buy(T1, "AAA", "1", "100"),
    });
    expect(existing).toHaveLength(before);
  });

  it("lanza RangeError si el id no existe (error de uso, no de datos)", () => {
    const existing = [deposit(T0, "100")];
    expect(() =>
      validateLedgerChange(existing, { kind: "remove", id: "nope" }),
    ).toThrow(RangeError);
    expect(() =>
      validateLedgerChange(existing, {
        kind: "replace",
        id: "nope",
        tx: deposit(T1, "1"),
      }),
    ).toThrow(RangeError);
  });

  it("es idéntico a recalcular el libro completo con el cambio aplicado", () => {
    const funding = deposit(T0, "5000");
    const purchase = buy(T1, "AAA", "10", "100", "1");
    const extra = sell(T3, "AAA", "4", "130", "1");
    const check = validateLedgerChange([funding, purchase], {
      kind: "add",
      tx: extra,
    });
    const direct = computeEngine([funding, purchase, extra]);
    expect(check.after.cash.toFixed()).toBe(direct.cash.toFixed());
    expect(check.after.totals.realizedPnl.toFixed()).toBe(
      direct.totals.realizedPnl.toFixed(),
    );
  });
});
