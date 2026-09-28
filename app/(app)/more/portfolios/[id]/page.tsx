import { notFound } from "next/navigation";
import { z } from "zod";
import {
  BenchmarkForm,
  DeletePortfolioForm,
  RenamePortfolioForm,
} from "@/components/app/portfolio-forms";
import { PageHeader } from "@/components/app/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/db/server";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { countTransactions } from "@/lib/portfolio/queries";

/** Renombrar o borrar un portafolio propio (RLS: uno ajeno no aparece y da 404). */
export default async function PortfolioSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { portfolios } = await getPortfolioContext(supabase);
  const portfolio = portfolios.find((p) => p.id === id);
  if (!portfolio) notFound();
  const transactions = await countTransactions(supabase, portfolio.account.id);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={portfolio.name} subtitle="Portafolio" />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Cambiar el nombre</CardTitle>
        </CardHeader>
        <CardContent>
          <RenamePortfolioForm id={portfolio.id} name={portfolio.name} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Comparar el rendimiento</CardTitle>
        </CardHeader>
        <CardContent>
          <BenchmarkForm
            id={portfolio.id}
            benchmark={portfolio.benchmarkSymbol}
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Borrar el portafolio</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {portfolios.length > 1 ? (
            <DeletePortfolioForm
              id={portfolio.id}
              name={portfolio.name}
              transactions={transactions}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Es tu único portafolio: no se puede borrar.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
