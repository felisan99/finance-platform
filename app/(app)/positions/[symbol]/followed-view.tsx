import type { SupabaseClient } from "@supabase/supabase-js";
import { FollowButton } from "@/components/app/follow-button";
import { Pnl } from "@/components/app/pnl";
import { PriceChart } from "@/components/app/price-chart";
import { RangeBar } from "@/components/app/range-bar";
import { Notice, PageHeader } from "@/components/app/stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Database } from "@/lib/db/database.types";
import { addDays, isoDate } from "@/lib/market-jobs/dates";
import { buildPositionChart } from "@/lib/portfolio/chart-data";
import { formatDayMonth, formatPrice } from "@/lib/portfolio/format";
import { withLiveBar } from "@/lib/portfolio/live-series";
import { getPriceSeries } from "@/lib/portfolio/queries";
import type { InstrumentRow } from "@/lib/portfolio/rows";
import { RANGE_DAYS } from "@/lib/portfolio/watchlist";
import { loadSymbolView } from "@/lib/portfolio/watchlist-data";

/**
 * Detalle de un símbolo que se sigue pero no se tiene (spec §10.4): precio, cambio del día, rango
 * de 52 semanas y el gráfico de un año. Sin costos ni operaciones: no hay posición.
 */
export async function FollowedSymbolView({
  supabase,
  instrument,
}: {
  supabase: SupabaseClient<Database>;
  instrument: InstrumentRow;
}) {
  const now = new Date();
  const [view, series] = await Promise.all([
    loadSymbolView(supabase, instrument, now),
    getPriceSeries(supabase, instrument.id, addDays(isoDate(now), -RANGE_DAYS)),
  ]);
  const chart = buildPositionChart(
    withLiveBar(series, {
      price: view.price,
      asOf: view.priceAsOf,
      source: view.priceSource,
    }),
    [],
    instrument.symbol,
    null,
  );

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={instrument.symbol}
        subtitle={
          <>
            {instrument.name}
            {view.typeLabel && (
              <Badge
                variant="secondary"
                className="ml-2 align-middle text-[0.65rem]"
              >
                {view.typeLabel}
              </Badge>
            )}
          </>
        }
        actions={
          <FollowButton symbol={instrument.symbol} followed leaveOnUnfollow />
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-1">
          {view.price !== null ? (
            <>
              <p className="text-sm text-muted-foreground">Precio</p>
              <p className="text-3xl font-semibold tabular-nums">
                {formatPrice(view.price)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Hoy </span>
                <Pnl value={view.dayChange} kind="money" />{" "}
                <span className="text-muted-foreground">(</span>
                <Pnl value={view.dayChangePct} kind="percent" />
                <span className="text-muted-foreground">)</span>
              </p>
              {view.priceAsOf && (
                <p className="text-xs text-muted-foreground">
                  {view.priceSource === "close" ? "Último cierre" : "Precio"} al{" "}
                  {formatDayMonth(view.priceAsOf)}
                </p>
              )}
            </>
          ) : (
            <Notice tone="warning">
              Todavía no hay precio de {instrument.symbol}. Se descarga solo en
              unos segundos: actualizá la página.
            </Notice>
          )}
        </CardContent>
      </Card>

      {view.price !== null && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Rango de 52 semanas</CardTitle>
          </CardHeader>
          <CardContent>
            <RangeBar range={view.range} />
            <p className="mt-2 text-xs text-muted-foreground">
              Mínimo y máximo de los cierres diarios, sin los extremos dentro
              del día.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Precio de cierre (1 año)</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceChart data={chart} symbol={instrument.symbol} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Seguís este símbolo, pero no tenés una posición: por eso no hay costos
        ni operaciones.
      </p>
    </div>
  );
}
