import Link from "next/link";
import { EmptyPortfolio } from "@/components/app/empty-state";
import { portfolioContextLine } from "@/components/app/portfolio-context";
import { ClosedPositionRow, PositionRow } from "@/components/app/position-row";
import { Pnl } from "@/components/app/pnl";
import { Notice, PageHeader, Stat } from "@/components/app/stat";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/db/server";
import { formatExact, formatMoney } from "@/lib/portfolio/format";
import {
  POSITION_SORT_LABELS,
  POSITION_SORTS,
  parsePositionSort,
  sortPositions,
  splitPositions,
} from "@/lib/portfolio/positions-list";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { loadScopeSnapshot } from "@/lib/portfolio/queries";
import { cn } from "@/lib/utils";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function PositionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const sort = parsePositionSort(params.orden);
  const showClosed = first(params.cerradas) === "1";
  const imported = Number(first(params.importadas) ?? "0");

  const supabase = await createClient();
  const context = await getPortfolioContext(supabase);
  const snapshot = context.scope
    ? await loadScopeSnapshot(supabase, context.scope)
    : null;
  const switcher = portfolioContextLine(context);
  if (!snapshot || snapshot.engine.positions.length === 0) {
    return (
      <>
        <PageHeader title="Posiciones" context={switcher} />
        <EmptyPortfolio />
      </>
    );
  }

  const { valued, engine } = snapshot;
  const { open, closed } = splitPositions(valued.positions);
  const sorted = sortPositions(open, sort);
  const href = (over: { orden?: string; cerradas?: boolean }) => {
    const query = new URLSearchParams();
    const orden = over.orden ?? sort;
    if (orden !== "value") query.set("orden", orden);
    if (over.cerradas ?? showClosed) query.set("cerradas", "1");
    const text = query.toString();
    return text ? `/positions?${text}` : "/positions";
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Posiciones"
        context={switcher}
        subtitle={`${open.length} abierta${open.length === 1 ? "" : "s"} · ${closed.length} cerrada${closed.length === 1 ? "" : "s"}`}
      />

      {Number.isInteger(imported) && imported > 0 && (
        <Notice tone="info">
          Se importaron {imported} operaciones. Los precios se descargan en
          segundo plano: si ves &ldquo;Sin precio&rdquo;, esperá un momento y
          actualizá la página.
        </Notice>
      )}
      {valued.missingPrices.length > 0 && (
        <Notice tone="warning">
          Falta el precio de {valued.missingPrices.join(", ")}: no se suman al
          valor de mercado. Si es una posición nueva se descarga sola en unos
          segundos: actualizá la página.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Costo base (abiertas)"
          hint={`Exacto: ${formatExact(engine.totals.openCostBasis)}`}
        >
          {formatMoney(engine.totals.openCostBasis)}
        </Stat>
        <Stat
          label="Valor de mercado"
          hint={<Pnl value={valued.unrealizedPnl} kind="money" />}
        >
          {formatMoney(valued.marketValue)}
        </Stat>
        <Stat
          label="Realizado (todas)"
          hint={`Exacto: ${formatExact(engine.totals.realizedPnl)}`}
        >
          <Pnl value={valued.realizedPnl} kind="money" />
        </Stat>
        <Stat label="Efectivo" hint={`Exacto: ${formatExact(engine.cash)}`}>
          {formatMoney(engine.cash)}
        </Stat>
      </div>

      <nav aria-label="Ordenar" className="flex gap-1.5 overflow-x-auto pb-1">
        {POSITION_SORTS.map((option) => (
          <Link
            key={option}
            href={href({ orden: option })}
            aria-current={option === sort ? "true" : undefined}
            className={cn(
              buttonVariants({
                variant: option === sort ? "default" : "outline",
                size: "sm",
              }),
              "shrink-0",
            )}
          >
            {POSITION_SORT_LABELS[option]}
          </Link>
        ))}
      </nav>

      <ul className="flex flex-col gap-2">
        {sorted.map((position) => (
          <li key={position.symbol}>
            <PositionRow
              position={position}
              instrument={snapshot.instrumentBySymbol.get(position.symbol)}
            />
          </li>
        ))}
      </ul>

      {closed.length > 0 && (
        <>
          <Link
            href={href({ cerradas: !showClosed })}
            className={cn(buttonVariants({ variant: "ghost" }), "self-center")}
          >
            {showClosed
              ? "Ocultar posiciones cerradas"
              : `Mostrar posiciones cerradas (${closed.length})`}
          </Link>
          {showClosed && (
            <ul className="flex flex-col gap-2">
              {closed.map((position) => (
                <li key={position.symbol}>
                  <ClosedPositionRow
                    position={position}
                    instrument={snapshot.instrumentBySymbol.get(
                      position.symbol,
                    )}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
