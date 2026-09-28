import Link from "next/link";
import { formatDateTime, formatMoney } from "@/lib/portfolio/format";
import type { TxView } from "@/lib/portfolio/tx-view";

/** Una operación en la lista (Actividad y detalle de posición). Toca para editar. */
export function TxRow({ view }: { view: TxView }) {
  return (
    <Link
      href={`/activity/${view.id}`}
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 active:bg-muted"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {view.typeLabel}
          {view.symbol && (
            <span className="text-muted-foreground"> · {view.symbol}</span>
          )}
          {view.portfolioName && (
            <span className="ml-1.5 inline-block max-w-32 truncate rounded bg-muted px-1.5 align-middle text-[0.65rem] font-normal text-muted-foreground">
              {view.portfolioName}
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">
          {view.detail || formatDateTime(view.executedAt)}
        </p>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        {/* Efectivo: no es ganancia ni pérdida, va sin color. */}
        <p className="text-sm">
          {view.cash.isZero() ? "—" : formatMoney(view.cash, { signed: true })}
        </p>
        {view.detail && (
          <p className="text-xs text-muted-foreground">
            {formatDateTime(view.executedAt)}
          </p>
        )}
      </div>
    </Link>
  );
}
