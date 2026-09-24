import { notFound } from "next/navigation";
import { Pnl } from "@/components/app/pnl";
import { PriceChart } from "@/components/app/price-chart";
import { Notice, PageHeader, Stat } from "@/components/app/stat";
import { TxRow } from "@/components/app/tx-row";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/db/server";
import { addDays, isoDate } from "@/lib/market-jobs/dates";
import { buildPositionChart } from "@/lib/portfolio/chart-data";
import {
  formatDayMonth,
  formatExact,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "@/lib/portfolio/format";
import { getPriceSeries, loadPortfolioSnapshot } from "@/lib/portfolio/queries";
import { describeTransaction } from "@/lib/portfolio/tx-view";
import { SYMBOL_PATTERN, normalizeSymbol } from "@/lib/validation/transaction";

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
  const snapshot = await loadPortfolioSnapshot(supabase);
  const position = snapshot?.valued.positions.find((p) => p.symbol === symbol);
  const instrument = snapshot?.instrumentBySymbol.get(symbol);
  if (!snapshot || !position || !instrument) notFound();

  const own = snapshot.transactions.filter(
    (tx) => "symbol" in tx && tx.symbol === symbol,
  );
  const firstTrade = own.reduce<Date | null>(
    (oldest, tx) =>
      oldest === null || tx.executedAt < oldest ? tx.executedAt : oldest,
    null,
  );
  // La serie arranca unos días antes de la primera operación (rueda previa y feriados).
  const series = firstTrade
    ? await getPriceSeries(
        supabase,
        instrument.id,
        addDays(isoDate(firstTrade), -7),
      )
    : [];
  const chart = buildPositionChart(
    series,
    own,
    symbol,
    position.avgCost?.toFixed() ?? null,
  );

  const symbolById = new Map(
    snapshot.instrumentById.entries().map(([id, i]) => [id, i.symbol]),
  );
  const history = snapshot.rows
    .filter((row) => row.instrument_id === instrument.id)
    .map((row) => describeTransaction(row, snapshot.account.id, symbolById))
    .reverse(); // de la más reciente a la más antigua

  const priced = position.price !== null;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={symbol}
        subtitle={
          <>
            {instrument.name}
            {instrument.type && (
              <Badge
                variant="secondary"
                className="ml-2 align-middle text-[0.65rem]"
              >
                {instrument.type === "ETF" ? "ETF" : "Acción"}
              </Badge>
            )}
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-1">
          {position.isOpen && priced ? (
            <>
              <p className="text-sm text-muted-foreground">Precio</p>
              <p className="text-3xl font-semibold tabular-nums">
                {formatPrice(position.price)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Hoy </span>
                <Pnl value={position.dayChange} kind="money" />{" "}
                <span className="text-muted-foreground">(</span>
                <Pnl value={position.dayChangePct} kind="percent" />
                <span className="text-muted-foreground">)</span>
              </p>
              {position.priceAsOf && (
                <p className="text-xs text-muted-foreground">
                  {position.priceSource === "close"
                    ? "Último cierre"
                    : "Precio"}{" "}
                  al {formatDayMonth(position.priceAsOf)}
                </p>
              )}
            </>
          ) : position.isOpen ? (
            <Notice tone="warning">
              Todavía no hay precio de {symbol}. Se muestra el costo base;
              actualizá los precios desde Inicio.
            </Notice>
          ) : (
            <p className="text-sm text-muted-foreground">Posición cerrada</p>
          )}
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Precio de cierre</CardTitle>
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
