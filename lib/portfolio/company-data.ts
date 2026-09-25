import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import {
  MarketDataError,
  describeError,
  getMarketDataProvider,
  type CompanyData,
} from "@/lib/market-data";
import {
  intradayInput,
  type ChartRange,
  type RangeInputPoint,
} from "./range-chart";
import type { InstrumentRow } from "./rows";

// Lectura de los datos de la empresa y de las series intradía a Yahoo, con caché. Son datos públicos
// (los mismos para todos), no de una persona: se comparten entre usuarios y visitas. La caché de
// Next las guarda entre invocaciones y despliegues; un fallo NO se cachea (la próxima visita vuelve
// a intentar). `unstable_cache` sigue disponible en Next 16 (la doc lo da por reemplazado por
// `use cache`, que exige activar Cache Components en toda la app: no vale la pena para esto).

/** Los datos de la empresa cambian poco (los de ganancias, una vez por trimestre). */
export const COMPANY_TTL_SECONDS = 60 * 60;
/** Las barras del día cambian seguido, pero una tarjeta no necesita el último minuto. */
export const INTRADAY_TTL_SECONDS = 5 * 60;

const fetchCompany = unstable_cache(
  async (
    providerSymbol: string,
    kind: "stock" | "etf",
  ): Promise<CompanyData> => {
    const provider = await getMarketDataProvider();
    if (!provider.getCompanyData) {
      throw new Error("el proveedor configurado no da datos de la empresa");
    }
    return provider.getCompanyData(providerSymbol, kind);
  },
  ["company-data"],
  { revalidate: COMPANY_TTL_SECONDS },
);

// Solo las barras ya convertidas a puntos (texto y números): la caché guarda JSON y una `Date` no
// vuelve como `Date`.
const fetchIntraday = unstable_cache(
  async (
    providerSymbol: string,
    range: Exclude<ChartRange, "1y">,
  ): Promise<RangeInputPoint[]> => {
    const provider = await getMarketDataProvider();
    if (!provider.getIntradaySeries) {
      throw new Error("el proveedor configurado no da series intradía");
    }
    return intradayInput(
      await provider.getIntradaySeries(providerSymbol, range),
    );
  },
  ["intraday-series"],
  { revalidate: INTRADAY_TTL_SECONDS },
);

export const kindOf = (
  instrument: Pick<InstrumentRow, "type">,
): "stock" | "etf" => (instrument.type === "ETF" ? "etf" : "stock");

/** El símbolo con el que Yahoo conoce al instrumento (casi siempre el mismo). */
export const providerSymbolOf = (
  instrument: Pick<InstrumentRow, "symbol" | "provider_symbol">,
): string => instrument.provider_symbol ?? instrument.symbol;

/**
 * Los datos de la empresa, o `null` si no se pudieron traer (la tarjeta se oculta o avisa; la ficha
 * no se rompe). Se comparte entre las tarjetas de una misma visita.
 */
export const loadCompanyData = cache(
  async (
    providerSymbol: string,
    kind: "stock" | "etf",
  ): Promise<CompanyData | null> => {
    try {
      return await fetchCompany(providerSymbol, kind);
    } catch (error) {
      // Un símbolo sin datos de empresa no es un problema para el log; un corte sí.
      if (!(error instanceof MarketDataError && error.kind === "NOT_FOUND")) {
        console.error("[company-data]", describeError(error));
      }
      return null;
    }
  },
);

/** Las barras de la semana o del mes; lanza si Yahoo falla (el que llama decide el respaldo). */
export function loadIntraday(
  providerSymbol: string,
  range: Exclude<ChartRange, "1y">,
): Promise<RangeInputPoint[]> {
  return fetchIntraday(providerSymbol, range);
}

/** Espera a `promise` como mucho `ms`: pasado ese tiempo devuelve `null` (sigue en segundo plano). */
export function orNullAfter<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
