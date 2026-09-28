import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CreatePortfolioForm } from "@/components/app/portfolio-forms";
import { Notice, PageHeader } from "@/components/app/stat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/db/server";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { MAX_PORTFOLIOS } from "@/lib/validation/portfolio";

/** Los portafolios de la persona: crear uno y entrar a cada uno para renombrarlo o borrarlo. */
export default async function PortfoliosPage() {
  const { portfolios, current } = await getPortfolioContext(
    await createClient(),
  );

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Portafolios"
        subtitle="Cada uno con sus operaciones, su efectivo y sus números."
      />

      <Card size="sm">
        <CardContent className="px-1">
          <ul className="divide-y">
            {portfolios.map((portfolio) => (
              <li key={portfolio.id}>
                <Link
                  href={`/more/portfolios/${portfolio.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0 truncate font-medium">
                    {portfolio.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {portfolio.id === current?.id && portfolios.length > 1 && (
                      <Badge variant="secondary">Mirando ahora</Badge>
                    )}
                    <ChevronRight
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Nuevo portafolio</CardTitle>
        </CardHeader>
        <CardContent>
          {portfolios.length >= MAX_PORTFOLIOS ? (
            <Notice tone="info">
              Llegaste al máximo de {MAX_PORTFOLIOS} portafolios. Borrá alguno
              para crear otro.
            </Notice>
          ) : (
            <CreatePortfolioForm />
          )}
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        La watchlist es una sola para todos. Para pasar plata de un portafolio a
        otro, cargá un retiro en uno y un depósito en el otro.
      </p>
    </div>
  );
}
