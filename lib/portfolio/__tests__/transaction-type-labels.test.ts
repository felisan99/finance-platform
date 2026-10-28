import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRANSACTION_TYPE_LABELS } from "@/lib/portfolio/transaction-type-labels";
import * as validation from "@/lib/validation/transaction";

describe("TRANSACTION_TYPE_LABELS", () => {
  it("fija las etiquetas de cada tipo", () => {
    expect(TRANSACTION_TYPE_LABELS).toEqual({
      BUY: "Compra",
      SELL: "Venta",
      DIVIDEND: "Dividendo",
      DEPOSIT: "Depósito",
      WITHDRAWAL: "Retiro",
      INTEREST: "Interés",
      FEE: "Comisión",
      TAX: "Impuesto",
      SPLIT: "Split",
    });
  });

  it("es la misma fuente que reexporta la validación", () => {
    expect(validation.TRANSACTION_TYPE_LABELS).toBe(TRANSACTION_TYPE_LABELS);
  });

  it("no importa nada (el cliente no debe arrastrar decimal.js ni zod)", () => {
    const src = readFileSync(
      new URL("../transaction-type-labels.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
