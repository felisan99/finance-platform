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

/** Ventana de un gráfico intradiario: la semana (barras de 30 min) o el mes (barras de 1 hora). */
export type IntradayRange = "1w" | "1m";

export interface IntradayPoint {
  /** Inicio de la barra. */
  at: Date;
  /** Cierre de la barra, como decimal en string. */
  close: string;
}

export interface EarningsQuarter {
  /** Fin del trimestre fiscal (YYYY-MM-DD). */
  periodEnd: string;
  epsActual: string | null;
  /** Consenso de los analistas antes de publicar. */
  epsEstimate: string | null;
  /** Real − estimado, tal como lo informa el proveedor. */
  epsDifference: string | null;
}

/**
 * Datos de la empresa o del fondo para la ficha de un activo. Solo se muestran: no entran a ningún
 * cálculo del portafolio ni se guardan. Cada dato puede faltar (`null`); los montos y las razones
 * son strings decimales, las cantidades (volumen, acciones, capitalización) enteros.
 */
export interface CompanyData {
  kind: "stock" | "etf";
  currency: string | null;
  previousClose: string | null;
  open: string | null;
  dayLow: string | null;
  dayHigh: string | null;
  /** Rango de 52 semanas del proveedor: incluye los extremos dentro del día. */
  fiftyTwoWeekLow: string | null;
  fiftyTwoWeekHigh: string | null;
  volume: number | null;
  /** Promedio de 3 meses. */
  averageVolume: number | null;
  marketCap: number | null;
  trailingPE: string | null;
  forwardPE: string | null;
  /** BPA de los últimos 12 meses. */
  epsTrailing: string | null;
  /** Dividendo anual por acción. */
  dividendRate: string | null;
  /** Fracción: 0.0026 = 0,26 %. */
  dividendYield: string | null;
  sharesOutstanding: number | null;
  floatShares: number | null;
  priceToBook: string | null;
  bookValue: string | null;
  priceToSales: string | null;
  beta: string | null;
  /** Solo fondos: patrimonio total, valor de la cuota, categoría y retorno del año (fracción). */
  totalAssets: number | null;
  navPrice: string | null;
  category: string | null;
  ytdReturn: string | null;
  /** YYYY-MM-DD. */
  nextEarningsDate: string | null;
  exDividendDate: string | null;
  /** Hasta 4 trimestres ya publicados, del más viejo al más nuevo. Vacío para un ETF. */
  earnings: EarningsQuarter[];
}

export interface MarketDataProvider {
  readonly name: string;
  search(query: string): Promise<InstrumentSearchResult[]>;
  /** Los símbolos que el proveedor no conoce se omiten del resultado. */
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getDailyHistory(symbol: string, from: Date, to: Date): Promise<DailyHistory>;
  getProfile?(symbol: string): Promise<InstrumentProfile>;
  /** Datos de la empresa (`stock`) o del fondo (`etf`) para la ficha; no guarda nada. */
  getCompanyData?(symbol: string, kind: "stock" | "etf"): Promise<CompanyData>;
  /** Barras del gráfico de la semana o del mes, de la más vieja a la más nueva. */
  getIntradaySeries?(
    symbol: string,
    range: IntradayRange,
  ): Promise<IntradayPoint[]>;
}
