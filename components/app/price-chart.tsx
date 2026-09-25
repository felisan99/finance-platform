"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { PositionChartData } from "@/lib/portfolio/chart-data";

const config = {
  close: { label: "Cierre", color: "var(--foreground)" },
} satisfies ChartConfig;

/** `2026-03-09` → `09/03`. */
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const longDate = (date: string) =>
  `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/**
 * Precio de cierre de una posición con marcadores de compra (verde) y de venta (rojo) y el costo
 * promedio como línea punteada. La serie está ajustada por splits hacia atrás; los marcadores van
 * sobre el cierre de su día. Solo dibuja: los números ya vienen calculados.
 */
export function PriceChart({
  data,
  symbol,
}: {
  data: PositionChartData;
  symbol: string;
}) {
  if (data.points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Todavía no hay historial de precios de {symbol}. Se descarga con el cron
        diario o al actualizar los precios.
      </p>
    );
  }

  const closes = data.points.map((p) => p.close);
  const lows = data.avgCost === null ? closes : [...closes, data.avgCost];
  const min = Math.min(...lows);
  const max = Math.max(...lows);
  const pad = (max - min) * 0.08 || max * 0.02;

  const last = data.points[data.points.length - 1]!;
  const first = data.points[0]!;
  const description = `Gráfico del precio de cierre de ${symbol} entre el ${longDate(first.date)} y el ${longDate(last.date)}, con ${data.markers.length} operaciones marcadas.`;

  return (
    <div className="flex flex-col gap-2">
      <ChartContainer
        config={config}
        className="aspect-auto h-56 w-full"
        role="img"
        aria-label={description}
      >
        <LineChart
          data={data.points}
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            minTickGap={36}
            tickMargin={6}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            width={46}
            tickFormatter={(value: number) => String(Math.round(value))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => longDate(String(label))}
              />
            }
          />
          <Line
            dataKey="close"
            type="monotone"
            stroke="var(--color-close)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {data.avgCost !== null && (
            <ReferenceLine
              y={data.avgCost}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
            />
          )}
          {data.markers.map((marker, index) => (
            <ReferenceDot
              key={`${marker.date}-${marker.type}-${index}`}
              x={marker.date}
              y={marker.close}
              r={5}
              fill={marker.type === "BUY" ? "var(--gain)" : "var(--loss)"}
              stroke="var(--background)"
              strokeWidth={2}
              ifOverflow="visible"
            />
          ))}
        </LineChart>
      </ChartContainer>
      {/* Sin operaciones ni costo promedio (un símbolo que solo se sigue) no hay nada que explicar. */}
      {(data.markers.length > 0 || data.avgCost !== null) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span aria-hidden="true" className="text-gain">
              ●
            </span>{" "}
            Compra
          </span>
          <span>
            <span aria-hidden="true" className="text-loss">
              ●
            </span>{" "}
            Venta
          </span>
          {data.avgCost !== null && <span>- - Costo promedio</span>}
        </p>
      )}
    </div>
  );
}
