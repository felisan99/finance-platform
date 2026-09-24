import YahooFinance from "yahoo-finance2";
import type { YahooClient } from "./yahoo";

const noop = () => {};

/**
 * Cliente real de `yahoo-finance2`, el único archivo que importa la librería: así los tests
 * unitarios y el resto de la app no cargan su árbol de dependencias.
 *
 * Yahoo no es una API oficial (ver docs/limits.md): sin cuotas publicadas, se lo usa con
 * límite de ritmo y reintentos desde `createYahooProvider`.
 */
export function createYahooClient(): YahooClient {
  const yahoo = new YahooFinance({
    suppressNotices: ["yahooSurvey"],
    // Por defecto la librería consulta si hay una versión nueva cada vez que falla algo.
    versionCheck: false,
    // Sin ruido informativo en los logs de Vercel (retienen solo 1 hora); los fallos se
    // registran de forma durable en market_job_runs.
    logger: {
      info: noop,
      debug: noop,
      dir: noop,
      warn: console.warn,
      error: console.error,
    },
  });

  return {
    chart: (symbol, options) => yahoo.chart(symbol, options),
    quote: (symbols) => yahoo.quote(symbols),
    search: (query, options) => yahoo.search(query, options),
    quoteSummary: (symbol, options) => yahoo.quoteSummary(symbol, options),
  };
}
