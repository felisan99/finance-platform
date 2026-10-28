import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  BeforeBuySection,
  BeforeBuySkeleton,
} from "@/components/app/before-buy-section";
import {
  CompanySkeleton,
  CompanyStatsCard,
} from "@/components/app/company-stats-card";
import { EarningsCard } from "@/components/app/earnings-card";
import { FollowButton } from "@/components/app/follow-button";
import { Pnl } from "@/components/app/pnl";
import { portfolioNameLine } from "@/components/app/portfolio-context";
import { PriceCard, type PriceCardData } from "@/components/app/price-card";
import { PriceChart } from "@/components/app/price-chart";
import {
  PriceRangeSection,
  PriceRangeSkeleton,
} from "@/components/app/price-range-section";
import { PageHeader, Stat } from "@/components/app/stat";
import { TxRow } from "@/components/app/tx-row";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/db/server";
import { addMonths } from "@/lib/engine";
import { addDays, isoDate } from "@/lib/market-jobs/dates";
import { buildPositionChart } from "@/lib/portfolio/chart-data";
import {
  companyTitle,
  kindOf,
  providerSymbolOf,
} from "@/lib/portfolio/company-data";
import {
  formatExact,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "@/lib/portfolio/format";
import { withLiveBar } from "@/lib/portfolio/live-series";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import {
  getPriceSeries,
  getWatchlistItems,
  loadScopeSnapshot,
} from "@/lib/portfolio/queries";
import { describeTransaction } from "@/lib/portfolio/tx-view";
import { loadSymbolView } from "@/lib/portfolio/watchlist-data";
import { SYMBOL_PATTERN, normalizeSymbol } from "@/lib/validation/transaction";
import { FollowedSymbolView } from "./followed-view";
import { typeLabelOf } from "@/lib/portfolio/instrument-type";

function symbolFromParam(raw: string): string | null {
  try {
    const symbol = normalizeSymbol(decodeURIComponent(raw));
    return symbol.length <= 15 && SYMBOL_PATTERN.test(symbol) ? symbol : null;
  } catch {
    return null; // %-secuencia mal formada
  }
}

export default async function PositionDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const symbol = symbolFromParam((await params).symbol);
  if (!symbol) notFound();

  const supabase = await createClient();
  const [context, followedItems] = await Promise.all([
    getPortfolioContext(supabase),
    getWatchlistItems(supabase),
  ]);
  const snapshot = context.scope
    ? await loadScopeSnapshot(supabase, context.scope)
    : null;
  const followedItem = followedItems.find(
    (item) => item.instruments.symbol === symbol,
  );
  const position = snapshot?.valued.positions.find((p) => p.symbol === symbol);
  const instrument = snapshot?.instrumentBySymbol.get(symbol);
  if (!snapshot || !position || !instrument) {
    // Sin posición: solo existe la página si el símbolo está en la watchlist.
    if (!followedItem) notFound();
    return (
      <FollowedSymbolView
        supabase={supabase}
        snapshot={snapshot}
        context={portfolioNameLine(context)}
        instrument={followedItem.instruments}
      />
    );
  }

  const own = snapshot.transactions.filter(
    (tx) => "symbol" in tx && tx.symbol === symbol,
  );
  const firstTrade = own.reduce<Date | null>(
    (oldest, tx) =>
      oldest === null || tx.executedAt < oldest ? tx.executedAt : oldest,
    null,
  );
  // Hasta 5 años de cierres (el rango más largo del gráfico) o, si la primera operación es más
  // vieja, desde unos días antes de ella: el cliente recorta cada rango sin volver a pedir datos.
  const fiveYears = addMonths(isoDate(new Date()), -60);
  const seriesFrom = firstTrade
    ? [addDays(isoDate(firstTrade), -7), fiveYears].sort()[0]!
    : fiveYears;
  const series = firstTrade
    ? await getPriceSeries(supabase, instrument.id, seriesFrom)
    : [];
  // Con la cotización de hoy como último punto mientras no exista el cierre de hoy.
  const chart = buildPositionChart(
    withLiveBar(series, {
      price: position.price,
      asOf: position.priceAsOf,
      source: position.priceSource,
    }),
    own,
    symbol,
    position.avgCost?.toFixed() ?? null,
  );

  const symbolById = new Map(
    snapshot.instrumentById.entries().map(([id, i]) => [id, i.symbol]),
  );
  // Con «Todo junto», las operaciones de todos los portafolios, cada una con el suyo.
  const multi = snapshot.scope.kind === "all";
  const history = snapshot.parts
    .flatMap((part) =>
      part.rows
        .filter((row) => row.instrument_id === instrument.id)
        .map((row) => ({
          ...describeTransaction(row, part.portfolio.account.id, symbolById),
          portfolioName: multi ? part.portfolio.name : null,
          seq: row.seq,
        })),
    )
    // De la más reciente a la más antigua (el mismo orden que Actividad).
    .sort(
      (a, b) =>
        b.executedAt.getTime() - a.executedAt.getTime() || b.seq - a.seq,
    );

  // Una posición cerrada no se valúa (el motor no le pone precio): el precio de hoy sale de la
  // misma lectura que la de un símbolo seguido. Así la ficha siempre muestra el precio.
  const symbolView = position.isOpen
    ? null
    : await loadSymbolView(supabase, instrument, new Date());
  const priceData: PriceCardData = symbolView ?? position;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={symbol}
        context={portfolioNameLine(context)}
        subtitle={
          <>
            {instrument.name}
            {instrument.type && (
              <Badge
                variant="secondary"
                className="ml-2 align-middle text-[0.65rem]"
              >
                {typeLabelOf(instrument.type)}
              </Badge>
            )}
          </>
        }
        actions={
          <FollowButton symbol={symbol} followed={followedItem !== undefined} />
        }
      />

      <PriceCard
        data={priceData}
        missing={
          position.isOpen
            ? `Todavía no hay precio de ${symbol}. Se muestra el costo base; actualizá los precios desde Inicio.`
            : `Todavía no hay precio de ${symbol}: se descarga con la actualización diaria.`
        }
        status={
          position.isOpen ? undefined : (
            <Badge variant="secondary">Posición cerrada</Badge>
          )
        }
      />

      <Suspense fallback={<PriceRangeSkeleton />}>
        <PriceRangeSection
          client={supabase}
          instrument={instrument}
          price={{
            price: priceData.price,
            asOf: priceData.priceAsOf,
            source: priceData.priceSource,
          }}
        />
      </Suspense>

      <Suspense fallback={<BeforeBuySkeleton />}>
        <BeforeBuySection
          client={supabase}
          snapshot={snapshot}
          instrument={instrument}
        />
      </Suspense>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Cantidad">{formatQuantity(position.quantity)}</Stat>
        <Stat label="Costo promedio">{formatPrice(position.avgCost)}</Stat>
        <Stat
          label="Costo base"
          hint={`Exacto: ${formatExact(position.costBasis)}`}
        >
          {formatMoney(position.costBasis)}
        </Stat>
        <Stat
          label="Valor de mercado"
          hint={
            position.weight !== null
              ? `${formatPercent(position.weight)} del portafolio`
              : undefined
          }
        >
          {formatMoney(position.marketValue)}
        </Stat>
        <Stat
          label="Ganancia no realizada"
          hint={<Pnl value={position.unrealizedPct} kind="percent" />}
        >
          <Pnl value={position.unrealizedPnl} kind="money" />
        </Stat>
        <Stat
          label="Ganancia realizada"
          hint={`Exacto: ${formatExact(position.realizedPnl)}`}
        >
          <Pnl value={position.realizedPnl} kind="money" />
        </Stat>
        <Stat label="Dividendos">{formatMoney(position.dividends)}</Stat>
      </div>

      <Suspense
        fallback={<CompanySkeleton title={companyTitle(kindOf(instrument))} />}
      >
        <CompanyStatsCard
          providerSymbol={providerSymbolOf(instrument)}
          kind={kindOf(instrument)}
        />
      </Suspense>

      <Suspense fallback={null}>
        <EarningsCard
          providerSymbol={providerSymbolOf(instrument)}
          kind={kindOf(instrument)}
        />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Tus operaciones en el gráfico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PriceChart data={chart} symbol={symbol} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Operaciones ({history.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-1">
          {history.map((view) => (
            <TxRow key={view.id} view={view} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
