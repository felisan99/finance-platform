import Link from "next/link";
import { Suspense } from "react";
import { AllocationCard } from "@/components/app/allocation-card";
import { EmptyPortfolio } from "@/components/app/empty-state";
import {
  PerformanceSection,
  PerformanceSkeleton,
} from "@/components/app/performance-section";
import { Pnl } from "@/components/app/pnl";
import { RefreshButton } from "@/components/app/refresh-button";
import { SnapshotSaver } from "@/components/app/snapshot-saver";
import { Notice, PageHeader, Stat } from "@/components/app/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/db/server";
import { buildAllocationViews } from "@/lib/portfolio/allocation-view";
import { buildDashboard, type Mover } from "@/lib/portfolio/dashboard";
import {
  formatDayMonth,
  formatExact,
  formatMoney,
} from "@/lib/portfolio/format";
import { loadPortfolioSnapshot } from "@/lib/portfolio/queries";
import { buildCachedSnapshot } from "@/lib/portfolio/snapshot-cache";
import { localYear } from "@/lib/portfolio/time";

function Movers({ title, movers }: { title: string; movers: Mover[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {movers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna hoy</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {movers.map((m) => (
              <li key={m.symbol}>
                <Link
                  href={`/positions/${encodeURIComponent(m.symbol)}`}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span className="font-medium">{m.symbol}</span>
                  <span>
                    <Pnl value={m.dayChangePct} kind="percent" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function HomePage() {
  const supabase = await createClient();
  const snapshot = await loadPortfolioSnapshot(supabase);
  const now = new Date();

  if (!snapshot || snapshot.transactions.length === 0) {
    return (
      <>
        <PageHeader title="Inicio" />
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
  return (
    <div className="flex flex-col gap-3">
      <SnapshotSaver json={JSON.stringify(buildCachedSnapshot(valued, now))} />
      <PageHeader title="Inicio" subtitle={snapshot.account.name} />

      <Card>
        <CardContent className="flex flex-col gap-1">
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
          {view.oldestPriceAt && (
            <p className="text-xs text-muted-foreground">
              Precios al {formatDayMonth(view.oldestPriceAt)}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <RefreshButton />
      </div>

      {view.missingPrices.length > 0 && (
        <Notice tone="warning">
          Falta el precio de {view.missingPrices.join(", ")}: el valor total no
          lo incluye. Si es una posición nueva se descarga sola en unos
          segundos: actualizá la página o tocá Actualizar precios.
        </Notice>
      )}
      {view.negativeCash && (
        <Notice tone="warning">
          El efectivo da negativo: probablemente falta cargar un depósito.{" "}
          <Link href="/activity/new" className="underline">
            Agregar operación
          </Link>
        </Notice>
      )}

      <Suspense fallback={<PerformanceSkeleton />}>
        <PerformanceSection snapshot={snapshot} />
      </Suspense>

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

      <div className="grid grid-cols-2 gap-3">
        <Movers title="Mejores del día" movers={view.gainers} />
        <Movers title="Peores del día" movers={view.losers} />
      </div>

      <Link href="/positions" className="text-center text-sm underline">
        Ver todas las posiciones
      </Link>
    </div>
  );
}
