"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { PnlText } from "@/components/app/pnl-text";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { niceScale } from "@/lib/portfolio/chart-scale";
import { formatChartTick } from "@/lib/portfolio/chart-format";
import type { MonthlyBarView } from "@/lib/portfolio/performance-view";

const config = {
  portfolio: { label: "Tu portafolio", color: "var(--foreground)" },
  benchmark: { label: "Benchmark", color: "var(--alloc-1)" },
} satisfies ChartConfig;

function MonthTooltip({
  active,
  payload,
  benchmarkLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: MonthlyBarView }>;
  benchmarkLabel: string;
}) {
  const month = active ? payload?.[0]?.payload : undefined;
  if (!month) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{month.title}</span>
      <span className="text-muted-foreground tabular-nums">
        Tu portafolio{" "}
        <PnlText text={month.portfolioText} tone={month.portfolioTone} />
      </span>
      {month.benchmark !== null && (
        <span className="text-muted-foreground tabular-nums">
          {benchmarkLabel}{" "}
          <PnlText text={month.benchmarkText} tone={month.benchmarkTone} />
        </span>
      )}
      {month.note && (
        <span className="text-muted-foreground">{month.note}</span>
      )}
    </div>
  );
}

/**
 * Rendimiento por mes calendario: barras de tu portafolio y del benchmark lado a lado, para ver en
 * qué meses le ganaste al mercado. Solo dibuja: los porcentajes y los textos vienen del servidor
 * (`lib/portfolio/performance-view.ts`). Los valores exactos están en una tabla plegable.
 */
export function MonthlyReturnsCard({
  months,
  benchmarkLabel,
  hasBenchmark,
}: {
  months: MonthlyBarView[];
  benchmarkLabel: string;
  hasBenchmark: boolean;
}) {
  if (months.length === 0) return null;
  const numbers = months.flatMap((m) =>
    [m.portfolio, hasBenchmark ? m.benchmark : null].flatMap((v) =>
      v === null ? [] : [v],
    ),
  );
  const scale = niceScale(Math.min(0, ...numbers), Math.max(0, ...numbers));
  const description = `Gráfico de barras del rendimiento mensual de tu portafolio${hasBenchmark ? ` contra ${benchmarkLabel}` : ""}, de ${months[0]!.title} a ${months.at(-1)!.title}.`;
  const partial = months.some((m) => m.note !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rendimiento por mes</CardTitle>
        <CardDescription>
          {hasBenchmark
            ? `Tu portafolio contra ${benchmarkLabel}`
            : "Tu portafolio"}
          , mes calendario
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ChartContainer
          config={config}
          className="aspect-auto h-48 w-full"
          role="img"
          aria-label={description}
        >
          <BarChart
            data={months}
            margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
            barCategoryGap="20%"
          >
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickMargin={6} interval={0} />
            <YAxis
              domain={scale.domain}
              ticks={scale.ticks}
              interval={0}
              width={44}
              tickFormatter={(value: number) =>
                `${formatChartTick(value, scale.decimals)}%`
              }
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={<MonthTooltip benchmarkLabel={benchmarkLabel} />}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" />
            <Bar
              dataKey="portfolio"
              fill="var(--color-portfolio)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            {hasBenchmark && (
              <Bar
                dataKey="benchmark"
                fill="var(--color-benchmark)"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            )}
          </BarChart>
        </ChartContainer>

        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span aria-hidden="true" className="text-foreground">
              ●
            </span>{" "}
            Tu portafolio
          </span>
          {hasBenchmark && (
            <span>
              <span aria-hidden="true" style={{ color: "var(--alloc-1)" }}>
                ●
              </span>{" "}
              {benchmarkLabel} (con dividendos)
            </span>
          )}
        </p>

        {partial && (
          <p className="text-xs text-muted-foreground">
            El primer mes cuenta desde tu primera operación y el último sigue en
            curso: no son meses completos.
          </p>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground underline">
            Ver los valores de cada mes
          </summary>
          <table className="mt-2 w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 font-normal">
                  Mes
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Tu portafolio
                </th>
                {hasBenchmark && (
                  <th scope="col" className="py-1 text-right font-normal">
                    {benchmarkLabel}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-t">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {m.title}
                    {m.note && (
                      <span className="block text-muted-foreground">
                        {m.note}
                      </span>
                    )}
                  </th>
                  <td className="py-1.5 text-right">
                    <PnlText text={m.portfolioText} tone={m.portfolioTone} />
                  </td>
                  {hasBenchmark && (
                    <td className="py-1.5 text-right">
                      <PnlText text={m.benchmarkText} tone={m.benchmarkTone} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </CardContent>
    </Card>
  );
}
