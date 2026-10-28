import { PriceChart } from "@/components/app/price-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Transaction } from "@/lib/engine";
import { buildPositionChart } from "@/lib/portfolio/chart-data";
import { downsampleSeries } from "@/lib/portfolio/downsample";
import { withLiveBar, type LivePrice } from "@/lib/portfolio/live-series";
import { monthsBefore } from "@/lib/portfolio/trade-chart-range";

const TITLE = "Tus operaciones en el gráfico";

/** Lo que se ve mientras se leen los años de cierres. */
export function TradeChartSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle className="text-sm">{TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-56 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * Gráfico de las operaciones de la ficha. Espera la lectura de hasta 5 años de cierres (compartida
 * con «Evolución del precio») en su propio `<Suspense>`, y al cliente le manda el último año diario
 * y lo anterior semanal, sin perder los días de las operaciones.
 */
export async function TradeChartSection({
  closes,
  price,
  transactions,
  symbol,
  avgCost,
}: {
  closes: Promise<Array<{ date: string; close: string }>>;
  price: LivePrice;
  transactions: readonly Transaction[];
  symbol: string;
  avgCost: string | null;
}) {
  // Con la cotización de hoy como último punto mientras no exista el cierre de hoy.
  const full = buildPositionChart(
    withLiveBar(await closes, price),
    transactions,
    symbol,
    avgCost,
  );
  const last = full.points.at(-1)?.date;
  const chart = last
    ? {
        ...full,
        points: downsampleSeries(full.points, {
          dailyFrom: monthsBefore(last, 12),
          keepDates: new Set(full.markers.map((m) => m.date)),
        }),
      }
    : full;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <PriceChart data={chart} symbol={symbol} />
      </CardContent>
    </Card>
  );
}
