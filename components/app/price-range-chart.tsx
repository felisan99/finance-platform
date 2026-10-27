"use client";

import { useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { getRangeSeries } from "@/app/(app)/positions/[symbol]/actions";
import { PnlText } from "@/components/app/pnl-text";
import { Segmented } from "@/components/app/segmented";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { niceScale } from "@/lib/portfolio/chart-scale";
import {
  formatChartMoney,
  axisWidthFor,
  formatChartTick,
} from "@/lib/portfolio/chart-format";
import {
  DAILY_RANGES,
  DEFAULT_RANGE,
  RANGE_NAME,
  RANGE_OPTIONS,
  type ChartRange,
} from "@/lib/portfolio/range-options";
import type { RangeSeries } from "@/lib/portfolio/range-chart";
import { cn } from "@/lib/utils";

type Loaded = { series: RangeSeries; notice: string | null };
type Point = { i: number; label: string; close: number };

const STROKE = {
  gain: "var(--gain)",
  loss: "var(--loss)",
  flat: "var(--foreground)",
} as const;

const GENERIC =
  "No pudimos traer el gráfico ahora. Probá de nuevo en un momento.";

function PriceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Point }>;
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{point.label}</span>
      <span className="text-muted-foreground tabular-nums">
        {formatChartMoney(point.close)}
      </span>
    </div>
  );
}

// Las etiquetas de las líneas de 52 semanas van FUERA de la franja del máximo y el mínimo (arriba
// del máximo, abajo del mínimo) y del lado donde la curva queda más lejos.

/** El rango con el que abre: 3M; si no alcanza para una línea pero el año sí, el año. */
function firstRange(
  initial: Partial<Record<ChartRange, RangeSeries | null>>,
): ChartRange {
  return !initial[DEFAULT_RANGE] && initial["1y"] ? "1y" : DEFAULT_RANGE;
}

/**
 * Precio de un activo con rango variable (1S, 1M, 3M, 1A) y el rango de 52 semanas superpuesto. 3M
 * y 1A llegan ya armados desde el servidor (de los mismos cierres diarios) y abre en 3M; la semana
 * y el mes se piden al tocarlos (barras del día, con caché) y se recuerdan en la pantalla. Solo
 * dibuja: las series, los cambios y las líneas ya vienen calculados (`lib/portfolio/range-chart.ts`).
 * `children` es lo que va debajo (la barra de rango).
 */
export function PriceRangeChart({
  symbol,
  initial,
  children,
}: {
  symbol: string;
  /** Las series de cierres diarios (3M y 1A); `null` la que no tiene dos puntos. */
  initial: Partial<Record<ChartRange, RangeSeries | null>>;
  children?: React.ReactNode;
}) {
  const [range, setRange] = useState<ChartRange>(() => firstRange(initial));
  const [loaded, setLoaded] = useState<Partial<Record<ChartRange, Loaded>>>(
    () =>
      Object.fromEntries(
        DAILY_RANGES.flatMap((id) => {
          const series = initial[id];
          return series ? [[id, { series, notice: null }]] : [];
        }),
      ),
  );
  const [pending, setPending] = useState<ChartRange | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Si se tocan dos rangos seguidos, gana el último que se tocó, no el que responde último.
  const wanted = useRef<ChartRange>(range);

  const current = loaded[range] ?? null;
  const series = current?.series ?? null;

  function select(next: ChartRange) {
    wanted.current = next;
    setProblem(null);
    // Los rangos de cierres diarios ya llegaron del servidor: nunca se piden.
    if (loaded[next] || DAILY_RANGES.includes(next)) {
      setPending(null);
      setRange(next);
      return;
    }
    setPending(next);
    getRangeSeries(symbol, next).then(
      (response) => {
        if (response.ok) {
          setLoaded((previous) => ({
            ...previous,
            [next]: { series: response.series, notice: response.notice },
          }));
        }
        if (wanted.current !== next) return;
        setPending(null);
        if (response.ok) setRange(next);
        else setProblem(response.message);
      },
      () => {
        if (wanted.current !== next) return;
        setPending(null);
        setProblem(GENERIC);
      },
    );
  }

  const data = useMemo<Point[]>(
    () => series?.points.map((p, i) => ({ i, ...p })) ?? [],
    [series],
  );
  const tickText = useMemo(
    () => new Map(series?.ticks.map((t) => [t.index, t.text])),
    [series],
  );
  const scale = series ? niceScale(series.domain[0], series.domain[1]) : null;
  const stroke = STROKE[series?.change?.tone ?? "flat"];
  const config = {
    close: { label: "Precio", color: stroke },
  } satisfies ChartConfig;
  const shownRange = pending ?? range;

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Rango del gráfico"
        value={shownRange}
        onChange={select}
        options={RANGE_OPTIONS}
        className="w-full"
      />

      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {series?.change && (
          <>
            En {RANGE_NAME[series.range]}:{" "}
            <PnlText
              text={`${series.change.text} (${series.change.pctText})`}
              tone={series.change.tone}
              className="font-medium"
            />
          </>
        )}
      </p>

      {series && scale ? (
        <div
          aria-busy={pending !== null}
          className={cn("transition-opacity", pending !== null && "opacity-50")}
        >
          <ChartContainer
            config={config}
            className="aspect-auto h-56 w-full"
            role="img"
            aria-label={series.description}
          >
            <LineChart
              data={data}
              margin={{ left: 0, right: 20, top: 8, bottom: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="i"
                type="number"
                domain={[0, Math.max(data.length - 1, 1)]}
                ticks={series.ticks.map((t) => t.index)}
                tickFormatter={(index: number) => tickText.get(index) ?? ""}
                interval={0}
                tickMargin={6}
              />
              <YAxis
                domain={scale.domain}
                ticks={scale.ticks}
                interval={0}
                width={axisWidthFor(
                  scale.ticks.map((tick) =>
                    formatChartTick(tick, scale.decimals),
                  ),
                  48,
                )}
                tickFormatter={(value: number) =>
                  formatChartTick(value, scale.decimals)
                }
              />
              <ChartTooltip content={<PriceTooltip />} />
              <Line
                dataKey="close"
                type="linear"
                stroke="var(--color-close)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {series.week52?.showHigh && (
                <ReferenceLine
                  y={series.week52.high}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  label={{
                    value: `Máx. 52 sem. ${series.week52.highText}`,
                    position:
                      series.week52.highSide === "left"
                        ? "insideBottomLeft"
                        : "insideBottomRight",
                    fontSize: 10,
                    fill: "var(--muted-foreground)",
                  }}
                />
              )}
              {series.week52?.showLow && (
                <ReferenceLine
                  y={series.week52.low}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  label={{
                    value: `Mín. 52 sem. ${series.week52.lowText}`,
                    position:
                      series.week52.lowSide === "left"
                        ? "insideTopLeft"
                        : "insideTopRight",
                    fontSize: 10,
                    fill: "var(--muted-foreground)",
                  }}
                />
              )}
            </LineChart>
          </ChartContainer>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {DAILY_RANGES.includes(range) && !loaded["1y"]
            ? `Todavía no hay historial de precios de ${symbol}. Se descarga con el cron diario o al actualizar los precios.`
            : "Todavía no hay datos suficientes para este rango."}
        </p>
      )}

      <p role="status" className="text-xs text-muted-foreground empty:-mt-3">
        {pending !== null
          ? `Cargando ${RANGE_NAME[pending]}…`
          : (problem ?? current?.notice ?? null)}
      </p>

      {series && (series.week52?.showHigh || series.week52?.showLow) && (
        <p className="text-xs text-muted-foreground">
          - - Máximo y mínimo de 52 semanas
        </p>
      )}
      {children}
    </div>
  );
}
