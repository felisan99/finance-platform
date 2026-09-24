"use client";

import { useState } from "react";
import { Pie, PieChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  AllocationDimension,
  AllocationSliceView,
  AllocationViews,
} from "@/lib/portfolio/allocation-view";
import { cn } from "@/lib/utils";

const config = {} satisfies ChartConfig;

function SliceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: AllocationSliceView }>;
}) {
  const slice = active ? payload?.[0]?.payload : undefined;
  if (!slice) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{slice.label}</span>
      <span className="text-muted-foreground tabular-nums">
        {slice.amount} · {slice.percent}
      </span>
    </div>
  );
}

/**
 * Composición del portafolio: una torta con hueco y, debajo, la lista con el nombre, el porcentaje
 * y el monto de cada porción. La lista lleva la información completa (el color solo ayuda a
 * relacionarla con el gráfico), así que el gráfico se oculta a los lectores de pantalla.
 * Solo dibuja: los números ya vienen calculados y formateados (`lib/portfolio/allocation-view.ts`).
 */
export function AllocationCard({ data }: { data: AllocationViews }) {
  const [dimension, setDimension] = useState<AllocationDimension>("position");
  const view =
    data.views.find((v) => v.dimension === dimension) ?? data.views[0]!;
  const chartData = view.slices.map((slice) => ({
    ...slice,
    fill: slice.color,
  }));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Composición</CardTitle>
        <div
          role="group"
          aria-label="Agrupar por"
          className="inline-flex rounded-lg bg-muted p-0.5"
        >
          {data.views.map((option) => {
            const active = option.dimension === view.dimension;
            return (
              <button
                key={option.dimension}
                type="button"
                aria-pressed={active}
                onClick={() => setDimension(option.dimension)}
                className={cn(
                  "h-8 rounded-md px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.title}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ChartContainer
          config={config}
          className="mx-auto aspect-square h-44"
          aria-hidden="true"
        >
          <PieChart>
            <ChartTooltip content={<SliceTooltip />} />
            <Pie
              data={chartData}
              dataKey="share"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={chartData.length > 1 ? 1.5 : 0}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </PieChart>
        </ChartContainer>

        <ul className="flex flex-col gap-2">
          {view.slices.map((slice) => (
            <li key={slice.id} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-[3px]"
                style={{ backgroundColor: slice.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {slice.label}
                </span>
                {slice.detail && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {slice.detail}
                  </span>
                )}
              </span>
              <span className="text-right tabular-nums">
                <span className="block">{slice.percent}</span>
                <span className="block text-xs text-muted-foreground">
                  {slice.amount}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
