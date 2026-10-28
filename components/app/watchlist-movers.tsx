import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MoverView } from "@/lib/portfolio/movers-view";
import { PnlText } from "./pnl-text";

const BAR_COLOR = {
  gain: "bg-gain",
  loss: "bg-loss",
  flat: "bg-muted-foreground/40",
};

/** Ancho de la barra sobre su pista; nunca menos de 6 %: una suba chica tiene que verse. */
const barWidth = (ratio: number) => `${Math.max(ratio * 100, 6)}%`;

/**
 * Hasta cinco filas ordenadas: posición, símbolo, una barra horizontal proporcional al mayor
 * movimiento de la tarjeta y el porcentaje (con signo y flecha) en una pastilla. Cada fila abre la
 * ficha del activo. Textos y proporciones vienen del servidor (`movers-view.ts`).
 */
export function MoversCard({
  title,
  movers,
  emptyText,
}: {
  title: string;
  movers: MoverView[];
  emptyText: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {movers.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="flex flex-col">
            {movers.map((mover, index) => (
              <li key={mover.symbol}>
                <Link
                  href={mover.href}
                  className="flex min-h-11 items-center gap-3 rounded-md px-1 active:bg-muted"
                >
                  <span
                    aria-hidden="true"
                    className="w-3 text-xs text-muted-foreground tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <span className="w-14 shrink-0 truncate text-sm font-semibold">
                    {mover.symbol}
                  </span>
                  <div
                    aria-hidden="true"
                    className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/60"
                  >
                    <div
                      className={`h-full rounded-full ${BAR_COLOR[mover.tone]}`}
                      style={{ width: barWidth(mover.ratio) }}
                    />
                  </div>
                  <PnlText
                    text={mover.text}
                    tone={mover.tone}
                    pill
                    className="w-20 shrink-0 text-center text-xs font-semibold whitespace-nowrap tabular-nums"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
