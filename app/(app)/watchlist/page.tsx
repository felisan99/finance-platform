import { RefreshButton } from "@/components/app/refresh-button";
import { Notice, PageHeader } from "@/components/app/stat";
import { WatchlistAddForm } from "@/components/app/watchlist-add-form";
import { WatchlistRow } from "@/components/app/watchlist-row";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/db/server";
import { WATCHLIST_MAX } from "@/lib/portfolio/watchlist";
import { loadWatchlist } from "@/lib/portfolio/watchlist-data";

export default async function WatchlistPage() {
  const supabase = await createClient();
  const rows = await loadWatchlist(supabase, new Date());
  const withoutPrice = rows.filter((row) => row.price === null);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Watchlist"
        subtitle={`${rows.length} de ${WATCHLIST_MAX} símbolos`}
        actions={<RefreshButton />}
      />

      {/* `overflow-visible`: la lista de sugerencias del buscador se despliega fuera de la tarjeta;
          con el `overflow-hidden` de siempre quedaba recortada contra el borde de abajo. */}
      <Card size="sm" className="overflow-visible">
        <CardContent>
          <WatchlistAddForm />
        </CardContent>
      </Card>

      {withoutPrice.length > 0 && (
        <Notice tone="warning">
          Todavía no hay precio de{" "}
          {withoutPrice.map((row) => row.symbol).join(", ")}. Un símbolo nuevo
          se descarga solo en unos segundos: actualizá la página.
        </Notice>
      )}

      {rows.length === 0 ? (
        <Card size="sm">
          <CardContent className="flex flex-col gap-1">
            <p className="font-medium">Todavía no seguís ningún símbolo</p>
            <p className="text-sm text-muted-foreground">
              Agregá acciones o ETF que te interesen para ver su precio, su
              cambio del día y su rango de 52 semanas sin tener que comprarlos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <WatchlistRow key={row.instrumentId} view={row} />
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          El rango de 52 semanas y el minigráfico (últimos 60 cierres) usan
          cierres diarios: no incluyen los máximos y mínimos dentro del día.
        </p>
      )}
    </div>
  );
}
