"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { PnlText } from "@/components/app/pnl-text";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { niceScale } from "@/lib/portfolio/chart-scale";
import {
  formatChartPercent,
  formatChartTick,
  formatDateKey,
  formatDayMonthKey,
} from "@/lib/portfolio/chart-format";
import type { MetricView, RiskView } from "@/lib/portfolio/performance-view";
import { cn } from "@/lib/utils";

const config = {
  drawdown: { label: "Caída", color: "var(--loss)" },
} satisfies ChartConfig;

function Item({
  label,
  metric,
  hint,
  plain = false,
}: {
  label: string;
  metric: MetricView;
  hint?: string | null;
  /** Un valor sin signo bueno ni malo (la volatilidad): texto normal, sin color de ganancia. */
  plain?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">
        {plain && metric.tone === null && !hint ? (
          metric.text
        ) : (
          <PnlText text={metric.text} tone={metric.tone} />
        )}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DrawdownTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: { date: string; drawdown: number } }>;
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{formatDateKey(point.date)}</span>
      <span className="text-muted-foreground tabular-nums">
        {point.drawdown === 0
          ? "En máximos"
          : `${formatChartPercent(point.drawdown)} del máximo`}
      </span>
    </div>
  );
}

/**
 * Riesgo del portafolio, plegado: el resumen (caída máxima y volatilidad) se ve siempre y al abrir
 * aparecen el detalle y el gráfico de caídas. El gráfico se monta recién al abrir: Recharts mide
 * el contenedor y dentro de algo oculto mediría cero. Los textos vienen del servidor
 * (`lib/portfolio/performance-view.ts`).
 */
export function RiskCard({ risk }: { risk: RiskView }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const lows = risk.curve.map((p) => p.drawdown);
  const scale = niceScale(Math.min(0, ...lows), 0);

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="min-w-0">
            <span className="block font-heading text-base leading-snug font-medium">
              Riesgo
            </span>
            <span className="block text-sm text-muted-foreground">
              Caída máxima{" "}
              <PnlText
                text={risk.maxDrawdown.text}
                tone={risk.maxDrawdown.tone}
              />
              {risk.hasVolatility && <> · Volatilidad {risk.volatility.text}</>}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CardHeader>
      {open && (
        <CardContent id={panelId} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 border-t pt-4">
            <Item
              label="Caída máxima"
              metric={risk.maxDrawdown}
              hint={risk.maxDrawdownDetail}
            />
            <Item label="Caída actual" metric={risk.currentDrawdown} />
            <Item
              label="Mejor día"
              metric={risk.bestDay}
              hint={risk.bestDayDate}
            />
            <Item
              label="Peor día"
              metric={risk.worstDay}
              hint={risk.worstDayDate}
            />
            <div className="col-span-2">
              <Item
                label="Volatilidad anual"
                metric={risk.volatility}
                hint={risk.volatilityHint}
                plain
              />
            </div>
          </div>

          {risk.curve.length >= 2 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                Distancia al máximo, día por día
              </p>
              <ChartContainer
                config={config}
                className="aspect-auto h-40 w-full"
                role="img"
                aria-label={`Gráfico de las caídas del portafolio desde su máximo, desde el ${risk.since}. La peor fue de ${risk.maxDrawdown.text}.`}
              >
                <AreaChart
                  data={risk.curve}
                  margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDayMonthKey}
                    minTickGap={36}
                    tickMargin={6}
                  />
                  <YAxis
                    domain={scale.domain}
                    ticks={scale.ticks}
                    interval={0}
                    width={44}
                    tickFormatter={(value: number) =>
                      `${formatChartTick(value, scale.decimals)}%`
                    }
                  />
                  <ChartTooltip content={<DrawdownTooltip />} />
                  <Area
                    dataKey="drawdown"
                    type="monotone"
                    baseValue={0}
                    stroke="var(--color-drawdown)"
                    strokeWidth={1.5}
                    fill="var(--color-drawdown)"
                    fillOpacity={0.25}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          )}

          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>
              Desde el {risk.since} ({risk.days} días con datos).
            </p>
            <p>
              La caída máxima es la mayor baja desde un máximo hasta el mínimo
              que le siguió. La volatilidad mide cuánto se mueve el portafolio
              (el desvío de los retornos diarios, anualizado). Se calculan sobre
              el rendimiento ponderado por tiempo, así que los depósitos y
              retiros no cuentan.
            </p>
            {risk.note && <p>{risk.note}</p>}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
