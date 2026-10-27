"use client";

import { useId, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { PnlText } from "@/components/app/pnl-text";
import { Segmented } from "@/components/app/segmented";
import { Input } from "@/components/ui/input";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  formatChartMoney,
  formatChartMoneyWhole,
  formatChartThousandsTick,
  formatChartTick,
  formatDateKey,
} from "@/lib/portfolio/chart-format";
import { niceScale } from "@/lib/portfolio/chart-scale";
import {
  MAX_AMOUNT,
  MIN_AMOUNT,
  TYPICAL_AMOUNT_ID,
  impactRows,
  parseAmount,
  planView,
} from "@/lib/portfolio/before-buy-amount";
import type {
  BeforeBuyView,
  ImpactView,
  WindowId,
  WindowView,
} from "@/lib/portfolio/before-buy-view";

/** La opción de escribir el monto. */
const CUSTOM = "custom";

const config = {
  value: { label: "Valor", color: "var(--foreground)" },
  invested: { label: "Aportado", color: "var(--muted-foreground)" },
  benchmark: { label: "Benchmark", color: "var(--alloc-1)" },
} satisfies ChartConfig;

interface ScaledPoint {
  date: string;
  invested: number;
  value: number;
  benchmark: number | null;
}

/** `2022-10-03` → `10/22`: el eje abarca años. */
const monthTick = (key: string) => `${key.slice(5, 7)}/${key.slice(2, 4)}`;

function PlanTooltip({
  active,
  payload,
  benchmarkLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ScaledPoint }>;
  benchmarkLabel: string | null;
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="grid gap-0.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <span className="font-medium">{formatDateKey(point.date)}</span>
      <span className="text-muted-foreground tabular-nums">
        Valor {formatChartMoney(point.value)}
      </span>
      <span className="text-muted-foreground tabular-nums">
        Aportado {formatChartMoney(point.invested)}
      </span>
      {benchmarkLabel && point.benchmark !== null && (
        <span className="text-muted-foreground tabular-nums">
          {benchmarkLabel} {formatChartMoney(point.benchmark)}
        </span>
      )}
    </div>
  );
}

function ImpactSection({
  impact,
  amount,
}: {
  impact: ImpactView;
  amount: number;
}) {
  const rows = impactRows(impact.model, amount);
  return (
    <>
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <dt className="min-w-0 text-muted-foreground">{row.label}</dt>
            <dd className="shrink-0 tabular-nums">
              <span className="text-muted-foreground">{row.before}</span>
              <span aria-hidden="true" className="mx-1.5 text-muted-foreground">
                →
              </span>
              <span className="sr-only"> pasa a </span>
              <span className="font-semibold">{row.after}</span>
            </dd>
          </div>
        ))}
      </dl>
      {impact.fit && (
        <div className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
          <p>
            <span className="text-muted-foreground">
              Parecido con el resto de tu cartera:{" "}
            </span>
            <span className="font-semibold tabular-nums">
              {impact.fit.value}
            </span>
          </p>
          <p>{impact.fit.sentence}</p>
          {impact.fit.closest && (
            <p className="text-muted-foreground">{impact.fit.closest}</p>
          )}
        </div>
      )}
      {impact.notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </>
  );
}

function PlanChart({
  period,
  amount,
  benchmarkLabel,
  symbol,
}: {
  period: WindowView;
  amount: number;
  benchmarkLabel: string | null;
  symbol: string;
}) {
  const points = useMemo<ScaledPoint[]>(
    () =>
      period.chart.map((p) => ({
        date: p.date,
        invested: p.invested * amount,
        value: p.value * amount,
        benchmark: p.benchmark === null ? null : p.benchmark * amount,
      })),
    [period, amount],
  );
  if (points.length < 2) return null;

  const numbers = points.flatMap((p) =>
    p.benchmark === null
      ? [p.invested, p.value]
      : [p.invested, p.value, p.benchmark],
  );
  // Pasados los 10.000 el eje va en miles («250 mil»): «250000» no entra en el ancho del eje.
  const unit = Math.max(...numbers) >= 10_000 ? 1000 : 1;
  const base = niceScale(
    Math.min(...numbers) / unit,
    Math.max(...numbers) / unit,
  );
  const domain: [number, number] = [
    base.domain[0] * unit,
    base.domain[1] * unit,
  ];
  const ticks = base.ticks.map((tick) => tick * unit);
  const tickText = (value: number) =>
    unit === 1
      ? formatChartTick(value, base.decimals)
      : formatChartThousandsTick(value, base.decimals);
  // Ancho del eje según la marca más larga («2000 mil»): si no entra, Recharts la parte en dos.
  const axisWidth =
    Math.max(...ticks.map((tick) => tickText(tick).length)) * 8 + 14;
  const hasBenchmark =
    benchmarkLabel !== null && points.some((p) => p.benchmark !== null);

  return (
    <>
      <ChartContainer
        config={config}
        className="aspect-auto h-48 w-full"
        role="img"
        aria-label={`Gráfico de lo aportado cada mes a ${symbol} y de lo que valdría${hasBenchmark ? `, comparado con ${benchmarkLabel}` : ""}.`}
      >
        <LineChart
          data={points}
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={monthTick}
            minTickGap={36}
            tickMargin={6}
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            interval={0}
            width={axisWidth}
            tickFormatter={tickText}
          />
          <ChartTooltip
            content={<PlanTooltip benchmarkLabel={benchmarkLabel} />}
          />
          <Line
            dataKey="invested"
            type="stepAfter"
            stroke="var(--color-invested)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
          {hasBenchmark && (
            <Line
              dataKey="benchmark"
              type="monotone"
              stroke="var(--color-benchmark)"
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )}
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span aria-hidden="true" className="text-foreground">
            ●
          </span>{" "}
          {symbol}
        </span>
        <span>
          <span aria-hidden="true">- -</span> Aportado
        </span>
        {hasBenchmark && (
          <span>
            <span aria-hidden="true" style={{ color: "var(--alloc-1)" }}>
              ●
            </span>{" "}
            {benchmarkLabel}
          </span>
        )}
      </p>
    </>
  );
}

/**
 * «Antes de comprar» (ficha de un activo): qué le haría una compra a la cartera y cómo le habría
 * ido a un aporte mensual en el activo. Solo elige monto y período y dibuja: los textos, los tonos
 * y lo medido por cada dólar vienen del servidor (`lib/portfolio/before-buy-view.ts`); con el monto
 * elegido (uno fijo o el que se escribe en «Otro») los escala `before-buy-amount.ts`, acá mismo.
 */
export function BeforeBuyCard({ view }: { view: BeforeBuyView }) {
  const [amountId, setAmountId] = useState(view.defaultAmountId);
  const [windowId, setWindowId] = useState<WindowId | null>(
    view.defaultWindowId,
  );
  // «Otro»: lo que se escribe, el último monto válido (es el que se muestra) y el aviso si no vale.
  const [customText, setCustomText] = useState("");
  const [customAmount, setCustomAmount] = useState<number | null>(null);
  const [customProblem, setCustomProblem] = useState<string | null>(null);
  const preset =
    view.amounts.find((a) => a.id === amountId) ??
    view.amounts.find((a) => a.id === view.defaultAmountId) ??
    view.amounts[0]!;
  const amount =
    amountId === CUSTOM ? (customAmount ?? preset.value) : preset.value;
  const period =
    view.windows.find((w) => w.id === windowId) ?? view.windows.at(-1) ?? null;
  const plan = period ? planView(period.plan, amount) : null;
  const id = useId();
  const hasTypical = view.amounts.some((a) => a.id === TYPICAL_AMOUNT_ID);

  function choose(next: string) {
    if (next === CUSTOM && amountId !== CUSTOM) {
      // Arranca con el monto que se estaba mirando, así el resultado no salta.
      setCustomText(String(amount));
      setCustomAmount(amount);
      setCustomProblem(null);
    }
    setAmountId(next);
  }

  function type(text: string) {
    setCustomText(text);
    const parsed = parseAmount(text);
    if (parsed.ok) {
      setCustomAmount(parsed.value);
      setCustomProblem(null);
    } else {
      setCustomProblem(parsed.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        {/* Cuatro fijos en una fila; abajo, el aporte típico (si lo hay) y «Otro». */}
        <Segmented
          label="Monto por mes"
          value={amountId}
          onChange={choose}
          options={[
            ...view.amounts.map((a) => ({
              id: a.id,
              text: a.text,
              className: a.id === TYPICAL_AMOUNT_ID ? "col-span-3" : "px-1",
            })),
            {
              id: CUSTOM,
              text: "Otro",
              className: hasTypical ? undefined : "col-span-4",
            },
          ]}
          className="grid w-full grid-cols-4"
        />
        {amountId === CUSTOM && (
          <div className="flex flex-col gap-1 pt-1">
            <label htmlFor={`${id}-amount`} className="text-xs font-medium">
              Monto por mes, en dólares
            </label>
            <Input
              id={`${id}-amount`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              placeholder="Por ejemplo, 1.500"
              value={customText}
              onChange={(event) => type(event.target.value)}
              aria-invalid={customProblem !== null || undefined}
              aria-describedby={`${id}-amount-hint`}
            />
            <p
              id={`${id}-amount-hint`}
              aria-live="polite"
              className={
                customProblem
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {customProblem
                ? `${customProblem} Se sigue mostrando ${formatChartMoneyWhole(amount)}.`
                : `De ${formatChartMoneyWhole(MIN_AMOUNT)} a ${formatChartMoneyWhole(MAX_AMOUNT)}, en dólares enteros.`}
            </p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{view.typicalNote}</p>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby={`${id}-impact`}>
        <h3 id={`${id}-impact`} className="text-sm font-medium">
          Qué le hace a tu cartera
        </h3>
        {view.impact ? (
          <ImpactSection impact={view.impact} amount={amount} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Cuando tengas posiciones, acá vas a ver qué le haría esta compra a
            tu cartera.
          </p>
        )}
      </section>

      <section
        className="flex flex-col gap-3 border-t pt-4"
        aria-labelledby={`${id}-plan`}
      >
        <h3 id={`${id}-plan`} className="text-sm font-medium">
          ¿Lo habrías aguantado?
        </h3>
        {period === null || plan === null ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay historia suficiente para simular aportes.
          </p>
        ) : (
          <>
            {view.windows.length > 1 && (
              <Segmented
                label="Período"
                value={period.id}
                onChange={setWindowId}
                options={view.windows.map((w) => ({
                  id: w.id,
                  text: w.label,
                }))}
                className="w-full"
              />
            )}
            <p className="text-sm text-muted-foreground">{plan.heading}</p>
            <PlanChart
              period={period}
              amount={amount}
              benchmarkLabel={view.benchmarkLabel}
              symbol={view.symbol}
            />
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">Aportado</p>
                <p className="text-base font-semibold tabular-nums">
                  {plan.invested}
                </p>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">Hoy valdría</p>
                <p className="text-base font-semibold tabular-nums">
                  {plan.value}
                </p>
                <p className="text-xs">
                  <PnlText text={plan.gain.text} tone={plan.gain.tone} />
                </p>
              </div>
            </div>
            {plan.benchmark && (
              <p className="text-sm">
                <span className="text-muted-foreground">
                  {plan.benchmark.text}{" "}
                </span>
                <PnlText
                  text={`(${plan.benchmark.gain.text})`}
                  tone={plan.benchmark.gain.tone}
                />
              </p>
            )}
            <p className="text-sm">{period.worst}</p>
            {period.question && (
              <p className="text-sm font-medium">
                ¿Habrías seguido comprando en ese momento?
              </p>
            )}
            {period.priceDrawdown && (
              <p className="text-sm text-muted-foreground">
                {period.priceDrawdown}
              </p>
            )}
          </>
        )}
      </section>

      <div className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
        <p>
          Volatilidad y parecido: tu cartera de hoy con los movimientos diarios
          del último año. El parecido va de −1 (se mueven al revés) a 1 (se
          mueven igual). Los aportes compran fracciones al cierre del primer día
          hábil de cada mes, con los dividendos reinvertidos. Cierres al{" "}
          {view.asOf}.
        </p>
        <p>
          Describe el pasado y cómo cambiaría tu cartera; no es una
          recomendación de compra.
        </p>
      </div>
    </div>
  );
}
