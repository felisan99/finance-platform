import { z } from "zod";
import type { MarketDataProvider } from "./types";

const providerNameSchema = z.enum(["yahoo", "finnhub", "twelvedata"]);
export type MarketDataProviderName = z.infer<typeof providerNameSchema>;

/** `MARKET_DATA_PROVIDER` (spec §13). Vacío o ausente = yahoo; un valor desconocido falla fuerte. */
export function parseProviderName(
  raw: string | undefined,
): MarketDataProviderName {
  const value = raw?.trim().toLowerCase();
  if (!value) return "yahoo";
  const parsed = providerNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `MARKET_DATA_PROVIDER inválido ("${value.slice(0, 30)}"): usar yahoo, finnhub o twelvedata`,
    );
  }
  return parsed.data;
}

/**
 * Proveedor configurado. Por ahora solo Yahoo está implementado: la cuota gratuita de Finnhub
 * no está verificada y Twelve Data limita a "non-display usage" (docs/limits.md). La interfaz
 * `MarketDataProvider` deja enchufar otro sin tocar los jobs.
 */
export async function getMarketDataProvider(
  rawName: string | undefined = process.env.MARKET_DATA_PROVIDER,
): Promise<MarketDataProvider> {
  const name = parseProviderName(rawName);
  if (name !== "yahoo") {
    throw new Error(
      `El proveedor "${name}" todavía no está implementado (solo yahoo)`,
    );
  }
  // Import dinámico: la librería (y su árbol de dependencias) solo se carga cuando hace falta.
  const [{ createYahooClient }, { createYahooProvider }] = await Promise.all([
    import("./yahoo-client"),
    import("./yahoo"),
  ]);
  return createYahooProvider(createYahooClient());
}
