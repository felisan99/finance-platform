import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { ValuedPosition } from "@/lib/engine";
import type { InstrumentRow } from "@/lib/portfolio/rows";
import {
  formatDayMonth,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "@/lib/portfolio/format";
import { Pnl } from "./pnl";
import { typeLabelOf } from "@/lib/portfolio/instrument-type";

const href = (symbol: string) => `/positions/${encodeURIComponent(symbol)}`;

/** Posición abierta: valor, ganancia y cambio del día (o el costo, si todavía no hay precio). */
export function PositionRow({
  position,
  instrument,
}: {
  position: ValuedPosition;
  instrument: InstrumentRow | undefined;
}) {
  const priced = position.marketValue !== null;
  return (
    <Link
      href={href(position.symbol)}
      className="flex flex-col gap-1 rounded-xl border bg-card p-3 text-card-foreground active:bg-muted"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            {position.symbol}
            {instrument?.type && (
              <Badge variant="secondary" className="text-[0.65rem]">
                {typeLabelOf(instrument.type)}
              </Badge>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {instrument?.name ?? ""}
          </p>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          {priced ? (
            <>
              <p className="font-semibold">
                {formatMoney(position.marketValue)}
              </p>
              <p className="text-xs">
                <Pnl value={position.unrealizedPnl} kind="money" />{" "}
                <span className="text-muted-foreground">·</span>{" "}
                <Pnl value={position.unrealizedPct} kind="percent" />
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">{formatMoney(position.costBasis)}</p>
              <Badge variant="outline" className="text-[0.65rem]">
                Sin precio · costo base
              </Badge>
            </>
          )}
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground tabular-nums">
        <span>
          {formatQuantity(position.quantity)} × {formatPrice(position.avgCost)}
          <span className="ml-1">
            (costo {formatMoney(position.costBasis)})
          </span>
        </span>
        {priced && (
          <span className="shrink-0">
            Hoy <Pnl value={position.dayChangePct} kind="percent" />
            {position.weight !== null && (
              <> · {formatPercent(position.weight)}</>
            )}
          </span>
        )}
      </div>
      {priced && position.priceAsOf && position.priceSource === "close" && (
        <p className="text-xs text-muted-foreground">
          Último cierre: {formatDayMonth(position.priceAsOf)}
        </p>
      )}
    </Link>
  );
}

/** Posición cerrada: solo importa lo realizado. */
export function ClosedPositionRow({
  position,
  instrument,
}: {
  position: ValuedPosition;
  instrument: InstrumentRow | undefined;
}) {
  return (
    <Link
      href={href(position.symbol)}
      className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 text-card-foreground active:bg-muted"
    >
      <div className="min-w-0">
        <p className="font-semibold">{position.symbol}</p>
        <p className="truncate text-xs text-muted-foreground">
          {instrument?.name ?? ""}
        </p>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <p className="text-xs text-muted-foreground">Realizado</p>
        <p className="font-semibold">
          <Pnl value={position.realizedPnl} kind="money" />
        </p>
        {!position.dividends.isZero() && (
          <p className="text-xs text-muted-foreground">
            Dividendos {formatMoney(position.dividends)}
          </p>
        )}
      </div>
    </Link>
  );
}
