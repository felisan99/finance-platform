"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { PnlText } from "@/components/app/pnl-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { niceScale } from "@/lib/portfolio/chart-scale";
import {
  formatChartIndex,
  formatChartMoney,
  formatChartTick,
  formatDateKey,
  formatDayMonthKey,
} from "@/lib/portfolio/chart-format";
import type {
  CurvePointView,
  MetricView,
  PerformanceView,
} from "@/lib/portfolio/performance-view";
import { cn } from "@/lib/utils";

type Mode = "value" | "compare";

const config = {
  value: { label: "Valor", color: "var(--foreground)" },
  portfolio: { label: "Tu portafolio", color: "var(--foreground)" },
  benchmark: { label: "Benchmark", color: "var(--alloc-1)" },
} satisfies ChartConfig;

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; text: string; disabled?: boolean }>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 rounded-lg bg-muted p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
          className={cn(
            "h-8 flex-1 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            option.id === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

function CurveTooltip({
  active,
  payload,
  mode,
  benchmarkLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CurvePointView }>;
  mode: Mode;
  benchmarkLabel: string;
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{formatDateKey(point.date)}</span>
      {mode === "value" && point.value !== null ? (
        <span className="text-muted-foreground tabular-nums">
          {formatChartMoney(point.value)}
        </span>
      ) : (
        <>
          <span className="text-muted-foreground tabular-nums">
            Tu portafolio {formatChartIndex(point.portfolio)}
          </span>
          {point.benchmark !== null && (
            <span className="text-muted-foreground tabular-nums">
              {benchmarkLabel} {formatChartIndex(point.benchmark)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  metric,
  hint,
}: {
  label: string;
  metric: MetricView;
  hint?: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">
        <PnlText text={metric.text} tone={metric.tone} />
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Rendimiento del portafolio (spec §10.1): gráfico con selector de período y comparación contra el
 * benchmark, más TWR, XIRR, benchmark y diferencia del período elegido. Solo dibuja y cambia de
 * período: los textos, los tonos y las curvas ya vienen calculados del servidor
 * (`lib/portfolio/performance-view.ts`).
 */
export function PerformanceCard({ view }: { view: PerformanceView }) {
  const [periodId, setPeriodId] = useState(
    view.periods.find((p) => p.id === "MAX")?.id ?? view.periods[0]!.id,
  );
  const [wantedMode, setMode] = useState<Mode>("value");
  const mode: Mode = view.hasBenchmark ? wantedMode : "value";
  const period =
    view.periods.find((p) => p.id === periodId) ?? view.periods[0]!;

  const points =
    mode === "value"
      ? period.points.filter((p) => p.value !== null)
      : period.points;
  const keys =
    mode === "value"
      ? (["value"] as const)
      : (["portfolio", "benchmark"] as const);
  const numbers = points.flatMap((p) =>
    keys.flatMap((key) => {
      const v = p[key];
      return v === null ? [] : [v];
    }),
  );
  if (mode === "compare") numbers.push(100);
  const scale = niceScale(Math.min(...numbers), Math.max(...numbers));

  const description =
    mode === "value"
      ? `Gráfico del valor del portafolio desde el ${period.since}.`
      : `Gráfico del rendimiento de tu portafolio contra ${view.benchmarkLabel} desde el ${period.since}, en base 100.`;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Rendimiento</CardTitle>
        <Segmented
          label="Qué mostrar"
          value={mode}
          onChange={setMode}
          options={[
            { id: "value", text: "Valor" },
            {
              id: "compare",
              text: `vs ${view.benchmarkLabel}`,
              disabled: !view.hasBenchmark,
            },
          ]}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Segmented
          label="Período"
          value={period.id}
          onChange={setPeriodId}
          options={view.periods.map((p) => ({ id: p.id, text: p.label }))}
          className="w-full"
        />

        {points.length < 2 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Todavía no hay suficientes días para dibujar el gráfico.
          </p>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-48 w-full"
            role="img"
            aria-label={description}
          >
            <LineChart
              data={points}
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
                width={mode === "value" ? 48 : 44}
                tickFormatter={(value: number) =>
                  formatChartTick(value, scale.decimals)
                }
              />
              <ChartTooltip
                content={
                  <CurveTooltip
                    mode={mode}
                    benchmarkLabel={view.benchmarkLabel}
                  />
                }
              />
              {mode === "compare" && (
                <ReferenceLine
                  y={100}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                />
              )}
              {keys.map((key) => (
                <Line
                  key={key}
                  dataKey={key}
                  type="monotone"
                  stroke={`var(--color-${key})`}
                  strokeWidth={key === "benchmark" ? 1.5 : 2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}

        {mode === "compare" && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span aria-hidden="true" className="text-foreground">
                ●
              </span>{" "}
              Tu portafolio
            </span>
            <span>
              <span aria-hidden="true" style={{ color: "var(--alloc-1)" }}>
                ●
              </span>{" "}
              {view.benchmarkLabel} (con dividendos)
            </span>
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Desde el {period.since}
          {period.truncated ? " (todo el historial)" : ""} · cierres al{" "}
          {view.asOf}
        </p>

        <div className="grid grid-cols-2 gap-x-3 gap-y-4 border-t pt-4">
          <Metric
            label="Rendimiento (TWR)"
            metric={period.twr}
            hint={
              period.twrAnnualized
                ? `Anualizado ${period.twrAnnualized.text}`
                : null
            }
          />
          <Metric
            label="XIRR (anual)"
            metric={period.xirr}
            hint={period.xirrHint}
          />
          <Metric label={view.benchmarkLabel} metric={period.benchmark} />
          <Metric
            label="Diferencia"
            metric={period.difference}
            hint={`vs. ${view.benchmarkLabel}`}
          />
        </div>

        {!view.hasBenchmark && (
          <p className="text-xs text-muted-foreground">
            Sin datos del {view.benchmarkLabel} todavía: tocá Actualizar
            precios.
          </p>
        )}
        {view.notes.map((note) => (
          <p key={note} className="text-xs text-muted-foreground">
            {note}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          {mode === "value"
            ? `El valor incluye tus depósitos y retiros (por eso sube a saltos): el rendimiento está en “vs ${view.benchmarkLabel}”. `
            : ""}
          El gráfico usa cierres diarios; el valor total de arriba usa la
          cotización del momento.
        </p>
      </CardContent>
    </Card>
  );
}
