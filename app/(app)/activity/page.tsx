import Link from "next/link";
import { portfolioContextLine } from "@/components/app/portfolio-context";
import { PageHeader } from "@/components/app/stat";
import { TxRow } from "@/components/app/tx-row";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/db/server";
import {
  activityQuery,
  groupByDay,
  parseActivityFilters,
} from "@/lib/portfolio/activity";
import { formatDayHeader } from "@/lib/portfolio/format";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import {
  portfolioOfAccount,
  portfoliosOfScope,
} from "@/lib/portfolio/portfolio-scope";
import { getActivityPage, getInstruments } from "@/lib/portfolio/queries";
import { TX_TYPES } from "@/lib/portfolio/rows";
import { describeTransaction } from "@/lib/portfolio/tx-view";
import { TRANSACTION_TYPE_LABELS } from "@/lib/validation/transaction";
import { cn } from "@/lib/utils";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseActivityFilters(await searchParams);
  const supabase = await createClient();
  const context = await getPortfolioContext(supabase);
  // Con «Todo junto», las operaciones de todos, cada una marcada con su portafolio.
  const scoped = context.scope ? portfoliosOfScope(context.scope) : [];
  const multi = context.scope?.kind === "all";
  const { rows, hasNext } = await getActivityPage(
    supabase,
    scoped.map((p) => p.account.id),
    filters,
  );

  const instruments = await getInstruments(supabase, [
    ...new Set(rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : []))),
  ]);
  const symbolById = new Map(instruments.map((i) => [i.id, i.symbol]));
  const groups = groupByDay(rows).map((group) => ({
    dayKey: group.dayKey,
    views: group.rows.map((row) => {
      const portfolio = portfolioOfAccount(scoped, row.account_id);
      return {
        ...describeTransaction(row, row.account_id, symbolById),
        portfolioName: multi ? (portfolio?.name ?? null) : null,
      };
    }),
  }));
  const filtered = Boolean(
    filters.type || filters.symbol || filters.from || filters.to,
  );

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Actividad"
        context={portfolioContextLine(context)}
        actions={
          <Link href="/activity/new" className={buttonVariants({ size: "sm" })}>
            Agregar
          </Link>
        }
      />

      <div className="flex gap-2 text-sm">
        <Link
          href="/activity/import"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Importar CSV
        </Link>
        {/* Descarga directa: un <a> común, no un Link (no debe pre-cargarse). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- descarga de un archivo: <Link> intentaría navegar */}
        <a
          href="/activity/export"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Exportar CSV
        </a>
      </div>

      <Card size="sm">
        <CardContent>
          <form
            method="get"
            action="/activity"
            className="grid grid-cols-2 gap-3"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <NativeSelect
                id="tipo"
                name="tipo"
                defaultValue={filters.type ?? ""}
              >
                <option value="">Todos</option>
                {TX_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TRANSACTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="simbolo">Símbolo</Label>
              <Input
                id="simbolo"
                name="simbolo"
                defaultValue={filters.symbol ?? ""}
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={15}
              />
            </div>
            <div className="col-span-2 flex min-w-0 flex-col gap-1.5 sm:col-span-1">
              <Label htmlFor="desde">Desde</Label>
              <Input
                id="desde"
                name="desde"
                type="date"
                defaultValue={filters.from ?? ""}
              />
            </div>
            <div className="col-span-2 flex min-w-0 flex-col gap-1.5 sm:col-span-1">
              <Label htmlFor="hasta">Hasta</Label>
              <Input
                id="hasta"
                name="hasta"
                type="date"
                defaultValue={filters.to ?? ""}
              />
            </div>
            <div className="col-span-2 flex gap-2">
              <Button type="submit" className="flex-1">
                Filtrar
              </Button>
              {filtered && (
                <Link
                  href="/activity"
                  className={buttonVariants({ variant: "outline" })}
                >
                  Limpiar
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filtered
            ? "No hay operaciones con esos filtros."
            : "Todavía no hay operaciones. Importá tu CSV o agregá una a mano."}
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.dayKey}
            aria-label={formatDayHeader(group.dayKey)}
          >
            <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground first-letter:uppercase">
              {formatDayHeader(group.dayKey)}
            </h2>
            <Card size="sm">
              <CardContent className="px-1">
                {group.views.map((view) => (
                  <TxRow key={view.id} view={view} />
                ))}
              </CardContent>
            </Card>
          </section>
        ))
      )}

      {(filters.page > 0 || hasNext) && (
        <nav aria-label="Páginas" className="flex justify-between gap-2">
          {filters.page > 0 ? (
            <Link
              href={`/activity${activityQuery({ ...filters, page: filters.page - 1 })}`}
              className={buttonVariants({ variant: "outline" })}
            >
              ← Más recientes
            </Link>
          ) : (
            <span />
          )}
          {hasNext && (
            <Link
              href={`/activity${activityQuery({ ...filters, page: filters.page + 1 })}`}
              className={buttonVariants({ variant: "outline" })}
            >
              Más antiguas →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
