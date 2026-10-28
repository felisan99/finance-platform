"use client";

import { useMemo, useState } from "react";
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
import { niceScale } from "@/lib/portfolio/chart-scale";
import {
  axisWidthFor,
  formatChartMoney,
  formatChartTick,
  formatDateKey,
} from "@/lib/portfolio/chart-format";
import {
  TRADE_RANGE_OPTIONS,
  defaultTradeRange,
  sliceByRange,
  tickFormatFor,
  type TradeChartRange,
} from "@/lib/portfolio/trade-chart-range";
import { cn } from "@/lib/utils";

const config = {
  close: { label: "Cierre", color: "var(--foreground)" },
} satisfies ChartConfig;

/**
 * Precio de cierre de una posición con marcadores de compra (verde) y de venta (rojo) y el costo
 * promedio como línea punteada. La serie está ajustada por splits hacia atrás; los marcadores van
 * sobre el cierre de su día. Solo dibuja: los números ya vienen calculados.
 *
 * Los rangos ("Desde tu compra", 1M, 3M, 1A, 5A) recortan en el cliente la serie que mandó el
 * servidor (hasta 5 años): cambiar de rango es inmediato. Sin desplazamiento lateral a propósito:
 * en el teléfono competiría con el scroll de la página (docs/decisions.md).
 */
export function PriceChart({
  data,
  symbol,
}: {
  data: PositionChartData;
  symbol: string;
}) {
  const [range, setRange] = useState<TradeChartRange>(
    defaultTradeRange(data.sinceStart),
  );
  const view = useMemo(
    () => sliceByRange(data.points, data.markers, range, data.sinceStart),
    [data, range],
  );
  const options = TRADE_RANGE_OPTIONS.filter(
    (option) => option.id !== "since" || data.sinceStart !== null,
  );

  if (data.points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Todavía no hay historial de precios de {symbol}. Se descarga con el cron
        diario o al actualizar los precios.
      </p>
    );
  }

  const closes = (view.points.length >= 2 ? view.points : data.points).map(
    (p) => p.close,
  );
  const lows = data.avgCost === null ? closes : [...closes, data.avgCost];
  const min = Math.min(...lows);
  const max = Math.max(...lows);
  const scale = niceScale(min, max);

  // Un rango siempre tiene al menos el último cierre; si quedara uno solo, se muestra la serie entera.
  const shown =
    view.points.length >= 2 ? view : { ...view, points: data.points };
  const last = shown.points[shown.points.length - 1]!;
  const first = shown.points[0]!;
  const description = `Gráfico del precio de cierre de ${symbol} entre el ${formatDateKey(first.date)} y el ${formatDateKey(last.date)}, con ${shown.markers.length} operaciones marcadas.`;

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Rango del gráfico"
        className="flex flex-wrap gap-x-1 gap-y-3"
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={range === option.id}
            onClick={() => setRange(option.id)}
            className={cn(
              "relative min-w-11 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']",
              range === option.id
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.text}
          </button>
        ))}
      </div>
      <ChartContainer
        config={config}
        className="aspect-auto h-56 w-full"
        role="img"
        aria-label={description}
      >
        <LineChart
          data={shown.points}
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={tickFormatFor(first.date, last.date)}
            minTickGap={36}
            tickMargin={6}
          />
          <YAxis
            domain={scale.domain}
            ticks={scale.ticks}
            interval={0}
            width={axisWidthFor(
              scale.ticks.map((tick) => formatChartTick(tick, scale.decimals)),
              46,
            )}
            tickFormatter={(value: number) =>
              formatChartTick(value, scale.decimals)
            }
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => formatDateKey(String(label))}
                formatter={(value) => (
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {formatChartMoney(Number(value))}
                  </span>
                )}
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
          {shown.markers.map((marker, index) => (
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
      {view.hiddenBefore > 0 && (
        <p className="text-xs text-muted-foreground">
          {view.hiddenBefore === 1
            ? "1 operación anterior queda fuera de este rango."
            : `${view.hiddenBefore} operaciones anteriores quedan fuera de este rango.`}
        </p>
      )}
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
