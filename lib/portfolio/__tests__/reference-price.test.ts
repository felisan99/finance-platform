import { describe, expect, it } from "vitest";
import { parseDecimalText } from "@/lib/validation/transaction";
import { buildReferencePrice } from "../reference-price";

const quote = (
  price: string,
  overrides: { asOf?: Date; currency?: string | null } = {},
) => ({
  price,
  // Viernes 25/09/2026 21:58 en Montevideo (UTC−3).
  asOf: overrides.asOf ?? new Date("2026-09-26T00:58:00Z"),
  currency: overrides.currency === undefined ? "USD" : overrides.currency,
});

describe("buildReferencePrice", () => {
  it("deja el precio plano para el formulario y el texto en es-UY con la hora de Montevideo", () => {
    expect(buildReferencePrice(quote("575.24"))).toEqual({
      price: "575.24",
      priceText: "US$ 575,24",
      asOfText: "25/09/2026 21:58",
    });
  });

  it("muestra hasta 4 decimales en el texto y guarda el precio entero", () => {
    const ref = buildReferencePrice(quote("0.12345678"));
    expect(ref?.price).toBe("0.12345678");
    expect(ref?.priceText).toBe("US$ 0,1235");
  });

  it("un precio con miles se escribe sin separador (el formulario no los acepta)", () => {
    const ref = buildReferencePrice(quote("1234.5"));
    expect(ref?.price).toBe("1234.5");
    expect(ref?.priceText).toBe("US$ 1.234,50");
  });

  it("acota los decimales al máximo del formulario (8)", () => {
    expect(buildReferencePrice(quote("10.123456789"))?.price).toBe(
      "10.12345679",
    );
  });

  it("todo lo que sugiere lo acepta el propio formulario", () => {
    for (const price of ["575.24", "0.0001", "9999999", "1.5", "250"]) {
      const ref = buildReferencePrice(quote(price));
      expect(ref).not.toBeNull();
      expect(
        parseDecimalText(ref?.price ?? "", {
          maxInt: 7,
          maxDecimals: 8,
          rule: "nonNegative",
        }).ok,
      ).toBe(true);
    }
  });

  it("sin cotización no hay referencia", () => {
    expect(buildReferencePrice(null)).toBeNull();
    expect(buildReferencePrice(undefined)).toBeNull();
  });

  it("no sugiere precios que el formulario rechazaría", () => {
    expect(buildReferencePrice(quote("0"))).toBeNull();
    expect(buildReferencePrice(quote("-5"))).toBeNull();
    expect(buildReferencePrice(quote("12345678"))).toBeNull(); // 8 enteros: el máximo es 7
    expect(buildReferencePrice(quote("abc"))).toBeNull();
    expect(buildReferencePrice(quote(""))).toBeNull();
    expect(buildReferencePrice(quote("0.000000001"))).toBeNull(); // redondea a 0 con 8 decimales
  });

  it("una notación científica se normaliza a decimal plano (el formulario no la acepta tal cual)", () => {
    expect(buildReferencePrice(quote("1e3"))?.price).toBe("1000");
  });

  it("una cotización en otra moneda no se sugiere: la app es solo USD", () => {
    expect(
      buildReferencePrice(quote("575.24", { currency: "EUR" })),
    ).toBeNull();
    expect(
      buildReferencePrice(quote("575.24", { currency: "UYU" })),
    ).toBeNull();
  });

  it("sin moneda informada se acepta (el símbolo ya se verificó en USD al darlo de alta)", () => {
    expect(
      buildReferencePrice(quote("575.24", { currency: null }))?.price,
    ).toBe("575.24");
  });

  it("una fecha inválida no se sugiere", () => {
    expect(
      buildReferencePrice(quote("575.24", { asOf: new Date("nope") })),
    ).toBeNull();
  });
});
