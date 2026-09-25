import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buildCompanyRows } from "@/lib/portfolio/company-view";
import { loadCompanyData } from "@/lib/portfolio/company-data";

/** Lo que se ve mientras se traen los datos de la empresa. */
export function CompanySkeleton({ title }: { title: string }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  );
}

/**
 * Datos de la empresa o del fondo (cierre anterior, volumen, capitalización, P/E, dividendo…), en
 * dos columnas como en Delta. Vienen de Yahoo con una hora de caché: son informativos, no entran a
 * ningún cálculo del portafolio. Sin datos, o si Yahoo falla, la tarjeta avisa y la ficha sigue.
 */
export async function CompanyStatsCard({
  providerSymbol,
  kind,
}: {
  providerSymbol: string;
  kind: "stock" | "etf";
}) {
  const title = kind === "etf" ? "Datos del fondo" : "Datos de la empresa";
  const data = await loadCompanyData(providerSymbol, kind);
  if (data === null) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No pudimos traer los datos ahora. Probá de nuevo en un rato.
          </p>
        </CardContent>
      </Card>
    );
  }
  const rows = buildCompanyRows(data);
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Datos de Yahoo Finance, con hasta una hora de demora. Son
          informativos.
        </p>
      </CardContent>
    </Card>
  );
}
