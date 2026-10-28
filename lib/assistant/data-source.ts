import type { DailyClose } from "@/lib/engine";
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
}

/** Una promesa que se pide una sola vez por pregunta, aunque varias tools la usen. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load());
}
