import Link from "next/link";
import { Suspense } from "react";
import { AllocationCard } from "@/components/app/allocation-card";
import { ContributionCard } from "@/components/app/contribution-card";
import { EmptyPortfolio } from "@/components/app/empty-state";
import { portfolioContextLine } from "@/components/app/portfolio-context";
import {
  MonthlyReturnsSection,
  PerformanceSection,
  PerformanceSkeleton,
  RiskSection,
  SectionSkeleton,
} from "@/components/app/performance-section";
import { PendingDividendsNotice } from "@/components/app/pending-dividends-notice";
import { Pnl } from "@/components/app/pnl";
import { RefreshButton } from "@/components/app/refresh-button";
import { SnapshotSaver } from "@/components/app/snapshot-saver";
import { Notice, PageHeader, Stat } from "@/components/app/stat";
import { TrendSection } from "@/components/app/trend-section";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/db/server";
import { buildAllocationViews } from "@/lib/portfolio/allocation-view";
import { buildContributionView } from "@/lib/portfolio/contribution-view";
import { buildDashboard } from "@/lib/portfolio/dashboard";
import {
  formatDayMonth,
  formatExact,
  formatMoney,
} from "@/lib/portfolio/format";
import { loadPerformanceOutcome } from "@/lib/portfolio/performance-data";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { scopeName } from "@/lib/portfolio/portfolio-scope";
import { loadScopeSnapshot } from "@/lib/portfolio/queries";
import { buildCachedSnapshot } from "@/lib/portfolio/snapshot-cache";
import { localYear } from "@/lib/portfolio/time";

export default async function HomePage() {
  const supabase = await createClient();
  const context = await getPortfolioContext(supabase);
  const snapshot = context.scope
    ? await loadScopeSnapshot(supabase, context.scope)
    : null;
  const now = new Date();
  const switcher = portfolioContextLine(context);

  if (!snapshot || snapshot.transactions.length === 0) {
    return (
      <>
        <PageHeader title="Inicio" context={switcher} />
        <EmptyPortfolio />
      </>
    );
  }

  const view = buildDashboard(snapshot.valued, snapshot.transactions, now);
  const { valued } = view;
  const allocation = buildAllocationViews(
    valued,
    (symbol) => snapshot.instrumentBySymbol.get(symbol)?.type ?? null,
  );
  const contribution = buildContributionView(valued, snapshot.engine.totals);
  // Los cierres de años de historial tardan más que el resto: se empieza a leer ya y las tres
  // secciones que lo usan (gráfico, por mes y riesgo) esperan la misma promesa, cada una en su
  // `<Suspense>`. Así Inicio aparece sin esperarlos y se lee una sola vez.
  const performance = loadPerformanceOutcome(supabase, snapshot);
  // Con «Todo junto», un portafolio con efectivo negativo sigue siendo un dato que falta cargar,
  // aunque la suma dé positiva: se nombra cuál.
  const negativeCashIn =
    snapshot.scope.kind === "all"
      ? snapshot.parts
          .filter((part) => part.engine.cash.lt(0))
          .map((part) => part.portfolio.name)
      : [];

  return (
    <div className="flex flex-col gap-3">
      <SnapshotSaver
        json={JSON.stringify(
          buildCachedSnapshot(
            valued,
            now,
            switcher ? scopeName(snapshot.scope) : null,
          ),
        )}
      />
      <PageHeader
        title="Inicio"
        context={switcher}
        subtitle={switcher ? undefined : scopeName(snapshot.scope)}
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">Valor total</p>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMoney(valued.totalValue)}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Hoy </span>
              <Pnl value={valued.dayChange} kind="money" />{" "}
              <span className="text-muted-foreground">(</span>
              <Pnl value={valued.dayChangePct} kind="percent" />
              <span className="text-muted-foreground">)</span>
            </p>
          </div>

          {view.netContributed.gt(0) && (
            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">Ganancia total</p>
                <p className="text-base font-semibold tabular-nums">
                  <Pnl value={view.totalGain} kind="money" />
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  <Pnl value={view.totalGainPct} kind="percent" /> sobre lo
                  aportado
                </p>
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-muted-foreground">Aportado neto</p>
                <p className="text-base font-semibold tabular-nums">
                  {formatMoney(view.netContributed)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Depósitos menos retiros
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {view.oldestPriceAt
                ? `Precios al ${formatDayMonth(view.oldestPriceAt)}`
                : ""}
            </p>
            <RefreshButton />
          </div>
        </CardContent>
      </Card>

      {view.missingPrices.length > 0 && (
        <Notice tone="warning">
          Falta el precio de {view.missingPrices.join(", ")}: el valor total no
          lo incluye. Si es una posición nueva se descarga sola en unos
          segundos: actualizá la página o tocá Actualizar precios.
        </Notice>
      )}
      {(view.negativeCash || negativeCashIn.length > 0) && (
        <Notice tone="warning">
          {negativeCashIn.length > 0
            ? `El efectivo de ${negativeCashIn.join(" y de ")} da negativo`
            : "El efectivo da negativo"}
          : probablemente falta cargar un depósito.{" "}
          <Link href="/activity/new" className="underline">
            Agregar operación
          </Link>
        </Notice>
      )}

      <Suspense fallback={null}>
        <PendingDividendsNotice snapshot={snapshot} />
      </Suspense>

      <Suspense fallback={<PerformanceSkeleton />}>
        <PerformanceSection outcome={performance} />
      </Suspense>

      <ContributionCard view={contribution} />

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Ganancia no realizada"
          hint={<Pnl value={valued.unrealizedPct} kind="percent" />}
        >
          <Pnl value={valued.unrealizedPnl} kind="money" />
        </Stat>
        <Stat label="Ganancia realizada">
          <Pnl value={valued.realizedPnl} kind="money" />
        </Stat>
        <Stat label="Efectivo" hint={`Exacto: ${formatExact(valued.cash)}`}>
          {formatMoney(valued.cash)}
        </Stat>
        <Stat label={`Dividendos ${localYear(now)}`}>
          {formatMoney(view.dividendsThisYear)}
        </Stat>
      </div>

      {allocation && <AllocationCard data={allocation} />}

      <Suspense fallback={<SectionSkeleton title="Tus posiciones" />}>
        <TrendSection snapshot={snapshot} now={now} />
      </Suspense>

      <Suspense fallback={<SectionSkeleton title="Rendimiento por mes" />}>
        <MonthlyReturnsSection outcome={performance} />
      </Suspense>

      <Suspense fallback={null}>
        <RiskSection outcome={performance} />
      </Suspense>
    </div>
  );
}
