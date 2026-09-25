import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDayMonth, formatPrice } from "@/lib/portfolio/format";
import type { WatchlistRowView } from "@/lib/portfolio/watchlist";
import { Pnl } from "./pnl";
import { RangeBar } from "./range-bar";
import { Sparkline } from "./sparkline";
import { WatchlistRowFooter } from "./watchlist-row-footer";

/**
 * Un símbolo seguido: precio, cambio del día, minigráfico y rango de 52 semanas. Toda la tarjeta
 * abre el detalle (enlace "estirado"); el botón de quitar queda por encima del enlace.
 */
export function WatchlistRow({ view }: { view: WatchlistRowView }) {
  const priced = view.price !== null;
  return (
    <li className="relative rounded-xl border bg-card p-3 text-card-foreground active:bg-muted">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            <Link
              href={`/positions/${encodeURIComponent(view.symbol)}`}
              className="after:absolute after:inset-0"
            >
              {view.symbol}
            </Link>
            {view.typeLabel && (
              <Badge variant="secondary" className="text-[0.65rem]">
                {view.typeLabel}
              </Badge>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {view.name ?? ""}
          </p>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          {priced ? (
            <>
              <p className="font-semibold">{formatPrice(view.price)}</p>
              <p className="text-xs">
                <Pnl value={view.dayChange} kind="money" />{" "}
                <span className="text-muted-foreground">·</span>{" "}
                <Pnl value={view.dayChangePct} kind="percent" />
              </p>
              {view.priceSource === "close" && view.priceAsOf && (
                <p className="text-xs text-muted-foreground">
                  Cierre del {formatDayMonth(view.priceAsOf)}
                </p>
              )}
            </>
          ) : (
            <Badge variant="outline" className="text-[0.65rem]">
              Sin precio todavía
            </Badge>
          )}
        </div>
      </div>
      <WatchlistRowFooter symbol={view.symbol}>
        <Sparkline values={view.spark} />
        <RangeBar range={view.range} className="flex-1" />
      </WatchlistRowFooter>
    </li>
  );
}
