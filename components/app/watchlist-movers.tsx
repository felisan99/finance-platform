import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MoverView } from "@/lib/portfolio/movers-view";
import { PnlText } from "./pnl-text";

const BAR_COLOR = {
  gain: "from-gain to-gain/10",
  loss: "from-loss to-loss/10",
  flat: "from-muted to-muted",
};

/**
 * Alto de la barra: su proporción del área que deja libre el porcentaje de arriba (así la mayor
 * llega al tope sin empujar el texto afuera), y nunca menos de medio rem: una suba chica tiene que
 * verse.
 */
const barHeight = (ratio: number) =>
  `max(calc((100% - 1.25rem) * ${ratio}), 0.5rem)`;

/**
 * Hasta cinco barras verticales: el porcentaje arriba (con signo y flecha), la barra y el símbolo.
 * Las columnas son siempre cinco, así las barras tienen el mismo ancho aunque haya menos. Cada una
 * abre la ficha del activo. Textos y proporciones vienen del servidor (`movers-view.ts`).
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
          <ul className="grid grid-cols-5 gap-1.5">
            {movers.map((mover) => (
              <li key={mover.symbol} className="min-w-0">
                <Link
                  href={mover.href}
                  className="flex flex-col items-center gap-1 rounded-md py-1 active:bg-muted"
                >
                  <div className="flex h-28 w-full flex-col items-center justify-end gap-1">
                    <PnlText
                      text={mover.text}
                      tone={mover.tone}
                      className="text-[0.65rem] font-semibold whitespace-nowrap"
                    />
                    <div
                      aria-hidden="true"
                      className={`w-3/4 max-w-12 rounded-t-md bg-linear-to-b ${BAR_COLOR[mover.tone]}`}
                      style={{ height: barHeight(mover.ratio) }}
                    />
                  </div>
                  <span className="w-full truncate text-center text-xs font-semibold">
                    {mover.symbol}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
