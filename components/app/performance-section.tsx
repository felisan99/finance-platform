import { Notice } from "@/components/app/stat";
import { PerformanceCard } from "@/components/app/performance-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { loadPerformance } from "@/lib/portfolio/performance-data";
import type { PerformanceView } from "@/lib/portfolio/performance-view";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";

/** Lo que se ve mientras se leen los cierres de años de historial. */
export function PerformanceSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>Rendimiento</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Rendimiento de Inicio. Va dentro de un `<Suspense>`: leer varios años de cierres tarda más que el
 * resto de la pantalla y no tiene que hacerla esperar. Si falla, el resto de Inicio sigue en pie.
 */
export async function PerformanceSection({
  snapshot,
}: {
  snapshot: PortfolioSnapshot;
}) {
  let view: PerformanceView | null = null;
  let failed = false;
  try {
    view = await loadPerformance(await createClient(), snapshot);
  } catch (error) {
    console.error("[performance]", describeError(error));
    failed = true;
  }

  if (failed) {
    return (
      <Notice tone="warning">
        No pudimos calcular el rendimiento ahora. Probá de nuevo en un rato.
      </Notice>
    );
  }
  if (!view) {
    return (
      <Notice tone="info">
        Todavía no hay precios históricos para calcular el rendimiento. Tocá
        Actualizar precios.
      </Notice>
    );
  }
  return <PerformanceCard view={view} />;
}
