import type { SupabaseClient } from "@supabase/supabase-js";
import { Suspense, type ReactNode } from "react";
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
import { PriceCard } from "@/components/app/price-card";
import {
  PriceRangeSection,
  PriceRangeSkeleton,
} from "@/components/app/price-range-section";
import { PageHeader } from "@/components/app/stat";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/lib/db/database.types";
import {
  companyTitle,
  kindOf,
  providerSymbolOf,
} from "@/lib/portfolio/company-data";
import type { InstrumentRow } from "@/lib/portfolio/rows";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import { loadSymbolView } from "@/lib/portfolio/watchlist-data";

/**
 * Detalle de un símbolo que se sigue pero no se tiene (spec §10.4): precio, cambio del día, el
 * gráfico con rango (1S/1M/3M/1A) y el rango de 52 semanas, «Antes de comprar» y los datos de la
 * empresa. Sin costos ni operaciones: no hay posición.
 */
export async function FollowedSymbolView({
  supabase,
  snapshot,
  context,
  instrument,
}: {
  supabase: SupabaseClient<Database>;
  // El portafolio que se está mirando, para «Antes de comprar»; `null` si la persona no tiene ninguno.
  snapshot: PortfolioSnapshot | null;
  /** El nombre del portafolio sobre el título (solo con más de uno). */
  context?: ReactNode;
  instrument: InstrumentRow;
}) {
  const view = await loadSymbolView(supabase, instrument, new Date());
  const kind = kindOf(instrument);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={instrument.symbol}
        context={context}
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

      <PriceCard
        data={view}
        missing={`Todavía no hay precio de ${instrument.symbol}. Se descarga solo en unos segundos: actualizá la página.`}
      />

      {view.price !== null && (
        <Suspense fallback={<PriceRangeSkeleton />}>
          <PriceRangeSection
            client={supabase}
            instrument={instrument}
            price={{
              price: view.price,
              asOf: view.priceAsOf,
              source: view.priceSource,
            }}
          />
        </Suspense>
      )}

      <Suspense fallback={<BeforeBuySkeleton />}>
        <BeforeBuySection
          client={supabase}
          snapshot={snapshot}
          instrument={instrument}
        />
      </Suspense>

      <Suspense fallback={<CompanySkeleton title={companyTitle(kind)} />}>
        <CompanyStatsCard
          providerSymbol={providerSymbolOf(instrument)}
          kind={kind}
        />
      </Suspense>

      <Suspense fallback={null}>
        <EarningsCard
          providerSymbol={providerSymbolOf(instrument)}
          kind={kind}
        />
      </Suspense>

      <p className="text-xs text-muted-foreground">
        Seguís este símbolo, pero no tenés una posición: por eso no hay costos
        ni operaciones.
      </p>
    </div>
  );
}
