/**
 * Contrato de los proveedores de datos de mercado (spec §7.1). Toda consulta externa pasa por
 * `MarketDataProvider`: el resto de la app no sabe qué proveedor hay detrás.
 *
 * Los montos son strings decimales ("1730.98"), nunca floats: el proveedor los redondea una
 * vez (Yahoo devuelve ruido de float32, p. ej. 1730.97998046875) y de ahí en adelante se
 * tratan con decimal.js.
 */

export interface Quote {
  /** Símbolo tal como lo devuelve el proveedor. */
  symbol: string;
  price: string;
  change: string | null;
  /** Fracción, no porcentaje: −0.0073 es −0,73 %. */
  changePct: string | null;
  asOf: Date;
  currency: string | null;
}

export interface DailyBar {
  /** Fecha de la rueda en la zona horaria de la bolsa (YYYY-MM-DD). */
  date: string;
  /** Cierre ajustado por splits (Yahoo lo reajusta hacia atrás) y sin ajustar por dividendos. */
  close: string;
  /** Cierre ajustado por splits y dividendos; sirve para retorno total. */
  adjClose: string | null;
}

export type CorporateAction =
  | { type: "SPLIT"; exDate: string; ratio: string }
  | { type: "DIVIDEND"; exDate: string; amount: string };

/**
 * Historial de una ventana. Las barras y los eventos salen de la MISMA respuesta: un split entre
 * dos consultas separadas dejaría precios ajustados y eventos desincronizados.
 */
export interface DailyHistory {
  /** Ascendentes por fecha, sin duplicados. */
  bars: DailyBar[];
  actions: CorporateAction[];
  /** Barras descartadas por venir sin cierre válido (Yahoo devuelve `null` algunos días). */
  droppedBars: number;
}

export interface InstrumentProfile {
  symbol: string;
  name: string | null;
  type: "STOCK" | "ETF" | null;
  exchange: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
}

export interface InstrumentSearchResult {
  /** Símbolo canónico: cumple el CHECK de `instruments.symbol`, listo para insertarlo. */
  symbol: string;
  name: string | null;
  type: "STOCK" | "ETF";
  exchange: string | null;
}

export interface MarketDataProvider {
  readonly name: string;
  search(query: string): Promise<InstrumentSearchResult[]>;
  /** Los símbolos que el proveedor no conoce se omiten del resultado. */
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getDailyHistory(symbol: string, from: Date, to: Date): Promise<DailyHistory>;
  getProfile?(symbol: string): Promise<InstrumentProfile>;
}
