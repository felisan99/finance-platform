import type { SupabaseClient } from "@supabase/supabase-js";
import { PriceRangeChart } from "@/components/app/price-range-chart";
import { RangeBar } from "@/components/app/range-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Database } from "@/lib/db/database.types";
import { d } from "@/lib/engine";
import type { LivePrice } from "@/lib/portfolio/live-series";
import { companyForChart } from "@/lib/portfolio/range-data";
import { loadDailyRanges, loadWeek52 } from "@/lib/portfolio/range-data";
import type { InstrumentRow } from "@/lib/portfolio/rows";
import { buildRange } from "@/lib/portfolio/watchlist";

/** Lo que se ve mientras se leen el año de cierres y los datos de la empresa. */
export function PriceRangeSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle className="text-sm">Evolución del precio</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-56 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * Tarjeta «Precio» de la ficha de un activo: el gráfico con rango (1S/1M/3M/1A) y, debajo, la barra
 * del rango de 52 semanas con el precio marcado. Lee el año de cierres (de ahí salen 3M y 1A) y los
 * datos de la empresa (de ahí sale el rango de 52 semanas oficial): si Yahoo tarda, usa los cierres
 * de la base.
 */
export async function PriceRangeSection({
  client,
  instrument,
  price,
}: {
  client: SupabaseClient<Database>;
  instrument: InstrumentRow;
  price: LivePrice;
}) {
  const now = new Date();
  const company = await companyForChart(instrument);
  const week52 = await loadWeek52(client, instrument, company, now);
  const daily = await loadDailyRanges({
    client,
    instrument,
    price,
    week52,
    now,
  });

  // La marca de la barra es el precio de hoy; sin precio, sin marca.
  const range =
    price.price === null
      ? null
      : buildRange(
          price.price,
          week52.low === null ? null : d(week52.low),
          week52.high === null ? null : d(week52.high),
        );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Evolución del precio</CardTitle>
      </CardHeader>
      <CardContent>
        <PriceRangeChart symbol={instrument.symbol} initial={daily}>
          {price.price !== null && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                Rango de 52 semanas
              </p>
              <RangeBar range={range} />
            </div>
          )}
        </PriceRangeChart>
      </CardContent>
    </Card>
  );
}
