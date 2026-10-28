import { addDays, isWeekday, type DailyClose, d } from "@/lib/engine";
import type { PortfolioRef } from "@/lib/portfolio/portfolio-scope";
import type {
  ClosesRow,
  InstrumentRow,
  TransactionRow,
} from "@/lib/portfolio/rows";

// Cartera demo para los evals y los tests del asistente. Todo es ficticio: los precios son
// caminatas aleatorias con semilla fija (no son precios reales de esos símbolos) y las operaciones
// están inventadas. El repo es público: nunca poner acá datos de una cartera real.
//
// Cubre lo que el asistente tiene que saber manejar: un split (NVDA 4:1), una posición cerrada
// (MSFT), ventas parciales, dividendos, comisiones, intereses, cripto los fines de semana y un
// símbolo sin ningún precio (XNEW) para las preguntas en las que la respuesta es "no tengo el dato".

/** "Hoy" de la demo: miércoles 30/09/2026, después del cierre de Nueva York. */
export const DEMO_NOW = new Date("2026-09-30T21:00:00Z");
export const DEMO_TODAY = "2026-09-30";
const FIRST_DAY = "2023-09-01";

export const DEMO_PORTFOLIO: PortfolioRef = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Portafolio demo",
  benchmarkSymbol: "SPY",
  account: {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Cuenta demo",
    currency: "USD",
    cost_method: "AVERAGE",
  },
};

interface Spec {
  symbol: string;
  name: string;
  type: "STOCK" | "ETF" | "CRYPTO";
  sector: string | null;
  start: number;
  /** Deriva diaria y volatilidad diaria de la caminata. */
  drift: number;
  vol: number;
  /** Split en el libro: los cierres guardados quedan ajustados hacia atrás. */
  split?: { date: string; ratio: number };
}

const SPECS: Spec[] = [
  {
    symbol: "SPY",
    name: "Demo S&P 500 ETF",
    type: "ETF",
    sector: null,
    start: 450,
    drift: 0.0004,
    vol: 0.009,
  },
  {
    symbol: "VOO",
    name: "Demo Index ETF",
    type: "ETF",
    sector: null,
    start: 410,
    drift: 0.0004,
    vol: 0.009,
  },
  {
    symbol: "AAPL",
    name: "Demo Apple",
    type: "STOCK",
    sector: "Technology",
    start: 180,
    drift: 0.0003,
    vol: 0.015,
  },
  {
    symbol: "MSFT",
    name: "Demo Microsoft",
    type: "STOCK",
    sector: "Technology",
    start: 330,
    drift: 0.0005,
    vol: 0.014,
  },
  {
    symbol: "NVDA",
    name: "Demo Nvidia",
    type: "STOCK",
    sector: "Technology",
    start: 460,
    drift: 0.0012,
    vol: 0.028,
    split: { date: "2025-06-10", ratio: 4 },
  },
  {
    symbol: "KO",
    name: "Demo Coca-Cola",
    type: "STOCK",
    sector: "Consumer Defensive",
    start: 58,
    drift: 0.0001,
    vol: 0.008,
  },
  {
    symbol: "AMZN",
    name: "Demo Amazon",
    type: "STOCK",
    sector: "Consumer Cyclical",
    start: 135,
    drift: 0.0006,
    vol: 0.02,
  },
  {
    symbol: "BTC-USD",
    name: "Demo Bitcoin",
    type: "CRYPTO",
    sector: null,
    start: 26000,
    drift: 0.0015,
    vol: 0.03,
  },
];

/** Generador con semilla (mulberry32): mismos precios en cada corrida. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cierres ajustados por split, como los guarda `prices_daily.close`. */
function generateCloses(spec: Spec, index: number): DailyClose[] {
  const random = seeded(1000 + index * 7919);
  const closes: DailyClose[] = [];
  let price = spec.start;
  for (let day = FIRST_DAY; day <= DEMO_TODAY; day = addDays(day, 1)) {
    if (spec.type !== "CRYPTO" && !isWeekday(day)) continue;
    // Box–Muller con la semilla: retornos normales con la deriva y la volatilidad del activo.
    const u = Math.max(random(), 1e-12);
    const v = random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    price *= Math.exp(spec.drift + spec.vol * z);
    const adjusted =
      spec.split && day < spec.split.date ? price / spec.split.ratio : price;
    closes.push({ date: day, close: d(adjusted.toFixed(2)) });
  }
  return closes;
}

export const DEMO_INSTRUMENTS: InstrumentRow[] = SPECS.map((spec, i) => ({
  id: `00000000-0000-4000-8000-1000000000${String(i).padStart(2, "0")}`,
  symbol: spec.symbol,
  name: spec.name,
  type: spec.type,
  exchange: spec.type === "CRYPTO" ? "CCC" : "NMS",
  sector: spec.sector,
  provider_symbol: spec.symbol,
})).concat({
  // Está en el libro pero no tiene ningún precio: "no tengo ese dato".
  id: "00000000-0000-4000-8000-100000000099",
  symbol: "XNEW",
  name: "Demo sin precios",
  type: "STOCK",
  exchange: "NMS",
  sector: null,
  provider_symbol: "XNEW",
});

export const DEMO_CLOSES: ReadonlyMap<string, DailyClose[]> = new Map(
  SPECS.map((spec, i) => [spec.symbol, generateCloses(spec, i)]),
);

const instrumentId = (symbol: string): string => {
  const row = DEMO_INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!row) throw new Error(`fixture: ${symbol} no existe`);
  return row.id;
};

/** El cierre de ese día (el precio al que se opera en la demo). */
export function demoClose(symbol: string, date: string): string {
  const close = DEMO_CLOSES.get(symbol)?.find((c) => c.date === date);
  if (!close) throw new Error(`fixture: sin cierre de ${symbol} el ${date}`);
  const spec = SPECS.find((s) => s.symbol === symbol);
  // La operación se hizo al precio de ese día, sin ajustar por el split posterior.
  const raw =
    spec?.split && date < spec.split.date
      ? close.close.mul(spec.split.ratio)
      : close.close;
  return raw.toFixed(2);
}

type Op =
  | {
      type: "DEPOSIT" | "WITHDRAWAL" | "FEE" | "INTEREST";
      date: string;
      amount: string;
    }
  | {
      type: "BUY" | "SELL";
      date: string;
      symbol: string;
      quantity: string;
      price?: string;
      fee?: string;
    }
  | { type: "DIVIDEND" | "TAX"; date: string; symbol: string; amount: string }
  | { type: "SPLIT"; date: string; symbol: string; ratio: string };

function monthlyDeposits(): Op[] {
  const ops: Op[] = [];
  for (let month = 0; month < 30; month++) {
    const year = 2024 + Math.floor((month + 3) / 12);
    const m = ((month + 3) % 12) + 1;
    let day = `${year}-${String(m).padStart(2, "0")}-05`;
    while (!isWeekday(day)) day = addDays(day, 1);
    ops.push({ type: "DEPOSIT", date: day, amount: "500" });
  }
  return ops;
}

const OPS: Op[] = [
  { type: "DEPOSIT", date: "2024-01-03", amount: "30000" },
  { type: "BUY", date: "2024-01-04", symbol: "VOO", quantity: "20", fee: "1" },
  { type: "BUY", date: "2024-01-04", symbol: "AAPL", quantity: "30", fee: "1" },
  { type: "BUY", date: "2024-02-01", symbol: "MSFT", quantity: "10", fee: "1" },
  { type: "BUY", date: "2024-03-01", symbol: "NVDA", quantity: "10", fee: "1" },
  { type: "BUY", date: "2024-03-15", symbol: "KO", quantity: "50", fee: "1" },
  ...monthlyDeposits(),
  { type: "DIVIDEND", date: "2024-06-14", symbol: "KO", amount: "24.25" },
  { type: "TAX", date: "2024-06-14", symbol: "KO", amount: "3.64" },
  {
    type: "SELL",
    date: "2024-09-13",
    symbol: "AAPL",
    quantity: "10",
    fee: "1",
  },
  { type: "BUY", date: "2025-01-10", symbol: "VOO", quantity: "10", fee: "1" },
  { type: "DIVIDEND", date: "2025-03-14", symbol: "VOO", amount: "52.30" },
  {
    type: "SELL",
    date: "2025-03-03",
    symbol: "MSFT",
    quantity: "10",
    fee: "1",
  },
  { type: "SPLIT", date: "2025-06-10", symbol: "NVDA", ratio: "4" },
  {
    type: "SELL",
    date: "2025-08-01",
    symbol: "NVDA",
    quantity: "15",
    fee: "1",
  },
  { type: "DIVIDEND", date: "2025-09-12", symbol: "KO", amount: "25.50" },
  {
    type: "BUY",
    date: "2025-11-03",
    symbol: "XNEW",
    quantity: "40",
    price: "12.50",
    fee: "1",
  },
  { type: "FEE", date: "2026-02-02", amount: "5" },
  { type: "INTEREST", date: "2026-03-31", amount: "3.20" },
  { type: "BUY", date: "2026-05-04", symbol: "AMZN", quantity: "15", fee: "1" },
  {
    type: "BUY",
    date: "2026-07-01",
    symbol: "BTC-USD",
    quantity: "0.05",
    fee: "2",
  },
  { type: "SELL", date: "2026-09-08", symbol: "AAPL", quantity: "5", fee: "1" },
];

/** Las operaciones como filas de la base (lo que lee `buildSnapshot`). */
export const DEMO_TRANSACTION_ROWS: TransactionRow[] = OPS.slice()
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  .map((op, seq) => {
    // 15:00Z = 11:00 en Nueva York: cada operación cae en su día de mercado.
    const executedAt = `${op.date}T15:00:00.000Z`;
    const base = {
      id: `00000000-0000-4000-8000-2000${String(seq).padStart(8, "0")}`,
      executed_at: executedAt,
      created_at: executedAt,
      currency: "USD",
      notes: null,
      source: "manual",
      external_id: null,
      seq,
      quantity: null,
      price: null,
      amount: null,
      fee: "0",
      split_ratio: null,
      instrument_id: null,
    };
    switch (op.type) {
      case "BUY":
      case "SELL":
        return {
          ...base,
          type: op.type,
          instrument_id: instrumentId(op.symbol),
          quantity: op.quantity,
          price: op.price ?? demoClose(op.symbol, op.date),
          fee: op.fee ?? "0",
        };
      case "DIVIDEND":
      case "TAX":
        return {
          ...base,
          type: op.type,
          instrument_id: instrumentId(op.symbol),
          amount: op.amount,
        };
      case "SPLIT":
        return {
          ...base,
          type: op.type,
          instrument_id: instrumentId(op.symbol),
          split_ratio: op.ratio,
        };
      default:
        return { ...base, type: op.type, amount: op.amount };
    }
  });

/** Último y anteúltimo cierre de cada instrumento hasta hoy (lo que da el RPC `instrument_prices`). */
export const DEMO_CLOSES_ROWS: ClosesRow[] = DEMO_INSTRUMENTS.flatMap((row) => {
  const closes = (DEMO_CLOSES.get(row.symbol) ?? []).filter(
    (c) => c.date <= DEMO_TODAY,
  );
  const last = closes.at(-1);
  const prev = closes.at(-2);
  if (!last) return [];
  return [
    {
      instrument_id: row.id,
      last_close: last.close.toFixed(),
      last_date: last.date,
      prev_close: prev ? prev.close.toFixed() : null,
      prev_date: prev ? prev.date : null,
    },
  ];
});
