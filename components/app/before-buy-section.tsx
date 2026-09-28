import type { SupabaseClient } from "@supabase/supabase-js";
import { BeforeBuyCard } from "@/components/app/before-buy-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Database } from "@/lib/db/database.types";
import { describeError } from "@/lib/market-data";
import { loadBeforeBuy } from "@/lib/portfolio/before-buy-data";
import type { BeforeBuyView } from "@/lib/portfolio/before-buy-view";
import type { InstrumentRow } from "@/lib/portfolio/rows";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";

const TITLE = "Antes de comprar";

/** Lo que se ve mientras se leen los cierres. */
export function BeforeBuySkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle className="text-sm">{TITLE}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * Tarjeta «Antes de comprar» de la ficha de un activo (posición o símbolo seguido). Va en su
 * `<Suspense>`: lee hasta 5 años de cierres de la base. Si falla, avisa sin tumbar la ficha; si el
 * símbolo todavía no tiene cierres (recién agregado), no se muestra.
 */
export async function BeforeBuySection({
  client,
  snapshot,
  instrument,
}: {
  client: SupabaseClient<Database>;
  snapshot: PortfolioSnapshot | null;
  instrument: InstrumentRow;
}) {
  let view: BeforeBuyView | null;
  try {
    view = await loadBeforeBuy(client, {
      snapshot,
      instrument,
      now: new Date(),
    });
  } catch (error) {
    console.error("[before-buy]", describeError(error));
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">{TITLE}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No pudimos calcular esto ahora. Probá de nuevo en un rato.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (view === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{TITLE}</CardTitle>
      </CardHeader>
      <CardContent>
        <BeforeBuyCard view={view} />
      </CardContent>
    </Card>
  );
}
