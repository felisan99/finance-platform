import type { DailyClose } from "@/lib/engine";
import type { CompanyData, InstrumentType, Quote } from "@/lib/market-data";
import type { BeforeBuyView } from "@/lib/portfolio/before-buy-view";
import type { AssembledPerformance } from "@/lib/portfolio/performance-build";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";

// De dónde leen las tools. En la app es Supabase con el cliente de la sesión (RLS: solo los datos
// de quien pregunta, `supabase-data-source.ts`); en los evals, un fixture en memoria. Las tools no
// saben cuál es: así los evals prueban exactamente el mismo código que corre en producción.

export interface PriceHistory {
  symbol: string;
  name: string | null;
  /** Cierres ajustados por splits (`prices_daily.close`), ordenados por fecha. */
  closes: DailyClose[];
}

/** Datos de hoy de cualquier activo, esté o no en la app: del proveedor, sin guardar nada. */
export interface AssetInfo {
  symbol: string;
  name: string | null;
  type: InstrumentType | null;
  sector: string | null;
  industry: string | null;
  /** `null` si el proveedor no devolvió cotización. */
  quote: Quote | null;
  /** `null` si no hubo datos de la empresa o del fondo. */
  company: CompanyData | null;
}

export type AssetInfoResult =
  | { status: "ok"; info: AssetInfo }
  /** El proveedor no lo conoce, o no es una acción, un ETF ni una cripto. */
  | { status: "not_found" }
  /** Se pasó el límite de consultas al proveedor (`search_symbols`). */
  | { status: "limited" }
  /** El proveedor falló o no respondió. */
  | { status: "unavailable" };

export interface AssistantDataSource {
  /** El instante de la pregunta: las tools no leen el reloj. */
  now: Date;
  /** "Portafolio principal" o "Todos los portafolios". */
  scopeName: string;
  snapshot(): Promise<PortfolioSnapshot>;
  /** `null` si todavía no hay operaciones o precios. */
  performance(): Promise<AssembledPerformance | null>;
  /** `null` si el símbolo no está en la base. */
  priceHistory(symbol: string, from: string): Promise<PriceHistory | null>;
  /** `null` si el símbolo no está en la base o no hay historia suficiente. */
  beforeBuy(symbol: string): Promise<BeforeBuyView | null>;
  /** Cotización y datos de empresa o fondo de hoy, de cualquier símbolo (no hace falta que esté en la base). */
  assetInfo(symbol: string): Promise<AssetInfoResult>;
}

/** Una promesa que se pide una sola vez por pregunta, aunque varias tools la usen. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load());
}
