// Contra qué puede compararse un portafolio. Sin imports: lo usan componentes de cliente (el
// formulario del portafolio) y del servidor. Una lista corta a propósito: cada benchmark es un
// instrumento que el cron tiene que mantener, y comparar contra cualquier símbolo confunde más de
// lo que ayuda.

export const BENCHMARKS = [
  { symbol: "SPY", label: "S&P 500", hint: "Acciones de EE.UU. (SPY)" },
  { symbol: "BTC-USD", label: "Bitcoin", hint: "Para un portafolio cripto" },
] as const;

export type BenchmarkSymbol = (typeof BENCHMARKS)[number]["symbol"];

export const BENCHMARK_SYMBOLS = BENCHMARKS.map((b) => b.symbol) as [
  BenchmarkSymbol,
  ...BenchmarkSymbol[],
];

/** «S&P 500» para SPY, «Bitcoin» para BTC-USD; otro símbolo se muestra tal cual. */
export function benchmarkLabel(symbol: string | null): string {
  if (symbol === null) return "Benchmark";
  return BENCHMARKS.find((b) => b.symbol === symbol)?.label ?? symbol;
}
