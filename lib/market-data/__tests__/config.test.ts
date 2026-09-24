import { describe, expect, it } from "vitest";
import { getMarketDataProvider, parseProviderName } from "../config";

describe("parseProviderName", () => {
  it("por defecto es yahoo", () => {
    expect(parseProviderName(undefined)).toBe("yahoo");
    expect(parseProviderName("")).toBe("yahoo");
    expect(parseProviderName("   ")).toBe("yahoo");
  });

  it("acepta los tres nombres del spec, sin importar mayúsculas ni espacios", () => {
    expect(parseProviderName("Finnhub")).toBe("finnhub");
    expect(parseProviderName(" TWELVEDATA ")).toBe("twelvedata");
    expect(parseProviderName("yahoo")).toBe("yahoo");
  });

  it("falla fuerte con un valor desconocido y no vuelca valores enormes", () => {
    expect(() => parseProviderName("bloomberg")).toThrow(
      /MARKET_DATA_PROVIDER inválido/,
    );
    expect(() => parseProviderName("x".repeat(500))).toThrow(/^(?!.*x{100})/);
  });
});

describe("getMarketDataProvider", () => {
  it.each(["finnhub", "twelvedata"])(
    "%s todavía no está implementado",
    async (name) => {
      await expect(getMarketDataProvider(name)).rejects.toThrow(
        /no está implementado/,
      );
    },
  );

  it("construye el proveedor de Yahoo con la librería real, sin hacer red", async () => {
    const provider = await getMarketDataProvider("yahoo");
    expect(provider.name).toBe("yahoo");
    expect(typeof provider.getDailyHistory).toBe("function");
    expect(typeof provider.getQuotes).toBe("function");
    expect(typeof provider.search).toBe("function");
  });
});
