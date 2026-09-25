import { MonthlyReturnsCard } from "@/components/app/monthly-returns-card";
import { PerformanceCard } from "@/components/app/performance-card";
import { RiskCard } from "@/components/app/risk-card";
import { Notice } from "@/components/app/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PerformanceOutcome } from "@/lib/portfolio/performance-data";

// Las secciones de Inicio que salen del rendimiento (gráfico, por mes y riesgo). Leer varios años de
// cierres tarda más que el resto de la pantalla: cada sección va en su `<Suspense>` y todas esperan
// la MISMA promesa (`loadPerformanceOutcome`, que nunca se rechaza), así se lee una sola vez y un
// fallo no tumba el resto de Inicio.

type Outcome = Promise<PerformanceOutcome>;

/** Lo que se ve mientras se leen los cierres de años de historial. */
export function PerformanceSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>Rendimiento</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-8 w-full" />
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

/** Un bloque de relleno para las secciones de abajo. */
export function SectionSkeleton({ title }: { title: string }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  );
}

export async function PerformanceSection({ outcome }: { outcome: Outcome }) {
  const result = await outcome;
  if (result.status === "error") {
    return (
      <Notice tone="warning">
        No pudimos calcular el rendimiento ahora. Probá de nuevo en un rato.
      </Notice>
    );
  }
  if (result.status === "empty") {
    return (
      <Notice tone="info">
        Todavía no hay precios históricos para calcular el rendimiento. Tocá
        Actualizar precios.
      </Notice>
    );
  }
  return <PerformanceCard view={result.view} />;
}

/** Sin datos o con error no muestra nada: el aviso ya lo da la sección del rendimiento. */
export async function MonthlyReturnsSection({ outcome }: { outcome: Outcome }) {
  const result = await outcome;
  if (result.status !== "ok") return null;
  return (
    <MonthlyReturnsCard
      months={result.view.monthly}
      benchmarkLabel={result.view.benchmarkLabel}
      hasBenchmark={result.view.hasBenchmark}
    />
  );
}

export async function RiskSection({ outcome }: { outcome: Outcome }) {
  const result = await outcome;
  if (result.status !== "ok" || result.view.risk === null) return null;
  return <RiskCard risk={result.view.risk} />;
}
