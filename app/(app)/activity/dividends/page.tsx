import { redirect } from "next/navigation";
import { DividendList, WithholdingForm } from "@/components/app/dividend-list";
import { portfolioContextLine } from "@/components/app/portfolio-context";
import { PageHeader } from "@/components/app/stat";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { RECORDED_AFTER_DAYS } from "@/lib/engine";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { loadPendingDividends } from "@/lib/portfolio/dividends-data";
import {
  WITHHOLDING_OPTIONS,
  buildPendingDividendsView,
  withholdingText,
  withholdingValueOf,
} from "@/lib/portfolio/dividends-view";
import { portfoliosOfScope } from "@/lib/portfolio/portfolio-scope";
import { loadScopeSnapshot } from "@/lib/portfolio/queries";

/**
 * Dividendos detectados: los que el proveedor informó para lo que la persona tenía el día antes
 * del ex-dividendo y que su libro no tiene. Se agregan con la retención de EE. UU. o se descartan.
 */
export default async function DividendsPage() {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) redirect("/login");

  const context = await getPortfolioContext(supabase);
  const header = (
    <PageHeader
      title="Dividendos detectados"
      context={portfolioContextLine(context)}
    />
  );
  if (!context.scope) return header;

  const snapshot = await loadScopeSnapshot(supabase, context.scope);
  const { rate, items } = await loadPendingDividends(
    supabase,
    snapshot,
    new Date(),
  );
  const view = buildPendingDividendsView(
    items,
    portfoliosOfScope(context.scope).length > 1,
  );

  return (
    <div className="flex flex-col gap-3">
      {header}
      <p className="text-sm text-muted-foreground">
        Los calcula la app con las acciones que tenías el día antes del
        ex-dividendo y el monto que informa el mercado. Al agregarlo se guarda
        el dividendo bruto y la retención ({withholdingText(rate)}) como
        impuesto, con la fecha del ex-dividendo; el cobro suele llegar unas
        semanas después. Si ya cargaste un dividendo del mismo activo hasta{" "}
        {RECORDED_AFTER_DAYS} días después, no se vuelve a proponer.
      </p>

      <Card size="sm">
        <CardContent>
          <WithholdingForm
            value={withholdingValueOf(rate)}
            options={WITHHOLDING_OPTIONS}
          />
        </CardContent>
      </Card>

      {view.length === 0 ? (
        <Card size="sm">
          <CardContent className="text-sm text-muted-foreground">
            No hay dividendos pendientes de revisar.
          </CardContent>
        </Card>
      ) : (
        <DividendList items={view} />
      )}
    </div>
  );
}
