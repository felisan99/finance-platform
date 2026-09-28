import { ZERO, type Dec } from "./decimal";
import { toPosition, type PositionState } from "./positions";
import type { DailySeries, SeriesPoint } from "./series";
import type { EngineIssue, EngineResult, EngineTotals } from "./types";

// «Todo junto»: varios portafolios vistos como uno. Puro.
//
// El libro es por cuenta (el costo promedio de un símbolo depende de las compras de ESA cuenta, y
// un `SPLIT` cargado en cada cuenta se aplicaría dos veces si se mezclaran las operaciones): por eso
// no se juntan las transacciones, se calcula cada cuenta por separado y se suman los resultados.
// Todo lo que se suma es lineal (cantidades, costos, realizado, efectivo, valor, flujos); lo que no
// lo es (costo promedio, crecimiento diario) se vuelve a calcular a partir de las sumas.

const sum = (values: readonly Dec[]): Dec =>
  values.reduce((acc, value) => acc.plus(value), ZERO);

const TOTAL_KEYS = [
  "openCostBasis",
  "realizedPnl",
  "dividends",
  "interest",
  "fees",
  "taxes",
  "deposits",
  "withdrawals",
] as const satisfies ReadonlyArray<keyof EngineTotals>;

/**
 * Suma los resultados del motor de varias cuentas. Un símbolo que está en más de una queda como una
 * sola posición: cantidades, costo base, realizado y dividendos sumados, y el costo promedio de la
 * suma (costo base total / cantidad total). Las observaciones de cada cuenta se conservan, salvo el
 * efectivo negativo, que se evalúa sobre el total (como en una cuenta sola).
 */
export function combineEngineResults(
  results: readonly EngineResult[],
): EngineResult {
  const bySymbol = new Map<string, PositionState>();
  for (const result of results) {
    for (const position of result.positions) {
      const current = bySymbol.get(position.symbol);
      bySymbol.set(position.symbol, {
        quantity: (current?.quantity ?? ZERO).plus(position.quantity),
        costBasis: (current?.costBasis ?? ZERO).plus(position.costBasis),
        realizedPnl: (current?.realizedPnl ?? ZERO).plus(position.realizedPnl),
        dividends: (current?.dividends ?? ZERO).plus(position.dividends),
      });
    }
  }
  const positions = [...bySymbol.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([symbol, state]) => toPosition(symbol, state));

  const totals = Object.fromEntries(
    TOTAL_KEYS.map((key) => [key, sum(results.map((r) => r.totals[key]))]),
  ) as unknown as EngineTotals;

  const cash = sum(results.map((r) => r.cash));
  const issues: EngineIssue[] = results.flatMap((r) =>
    r.issues.filter((issue) => issue.code !== "NEGATIVE_CASH"),
  );
  if (cash.lt(0))
    issues.push({ severity: "warning", code: "NEGATIVE_CASH", cash });

  return { positions, cash, totals, issues };
}

/**
 * Suma las series diarias de varias cuentas día por día: valor, efectivo, valor de mercado y
 * flujos. Antes de su primer día, una cuenta suma 0 (todavía no existía); si alguna terminara antes
 * que las otras, sigue valiendo su último punto, sin flujos. El crecimiento diario se vuelve a
 * calcular con la misma convención que `buildDailySeries` sobre los totales, así el TWR de la suma
 * es el de la cartera entera (no un promedio de los TWR de cada cuenta). Con una sola serie,
 * devuelve exactamente la misma.
 */
export function combineSeries(list: readonly DailySeries[]): DailySeries {
  const series = list.filter((s) => s.points.length > 0);
  const empty: DailySeries = {
    points: [],
    baseDate: null,
    unpricedSymbols: [],
    noBaseDays: 0,
  };
  if (series.length === 0) return empty;

  const dates = [
    ...new Set(series.flatMap((s) => s.points.map((p) => p.date))),
  ].sort();
  const byDate = series.map(
    (s) => new Map(s.points.map((point) => [point.date, point])),
  );
  const lastOf = series.map((s) => s.points[s.points.length - 1]!);

  const points: SeriesPoint[] = [];
  let previousValue = ZERO;
  let noBaseDays = 0;
  for (const date of dates) {
    let value = ZERO;
    let cash = ZERO;
    let marketValue = ZERO;
    let flow = ZERO;
    const unpriced = new Set<string>();
    series.forEach((s, i) => {
      const point = byDate[i]!.get(date);
      if (point) {
        value = value.plus(point.value);
        cash = cash.plus(point.cash);
        marketValue = marketValue.plus(point.marketValue);
        flow = flow.plus(point.flow);
        for (const symbol of point.unpriced) unpriced.add(symbol);
      } else if (date > lastOf[i]!.date) {
        // Terminó antes: su último valor sigue ahí, sin movimientos.
        value = value.plus(lastOf[i]!.value);
        cash = cash.plus(lastOf[i]!.cash);
        marketValue = marketValue.plus(lastOf[i]!.marketValue);
      }
      // Antes de su primer día no suma nada.
    });

    const base = previousValue.plus(flow);
    let growth: Dec | null = null;
    if (base.gt(0)) growth = value.div(base);
    else noBaseDays++;

    points.push({
      date,
      value,
      cash,
      marketValue,
      flow,
      growth,
      unpriced: [...unpriced].sort(),
    });
    previousValue = value;
  }

  return {
    points,
    baseDate: series
      .map((s) => s.baseDate!)
      .reduce((min, date) => (date < min ? date : min)),
    unpricedSymbols: [
      ...new Set(series.flatMap((s) => s.unpricedSymbols)),
    ].sort(),
    noBaseDays,
  };
}
