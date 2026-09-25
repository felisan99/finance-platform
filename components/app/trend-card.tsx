import Link from "next/link";
import { Pnl } from "@/components/app/pnl";
import { Sparkline } from "@/components/app/sparkline";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TrendRowView } from "@/lib/portfolio/trend-view";

/**
 * "Tus posiciones" de Inicio: las más grandes con su tendencia del último mes (minigráfico de
 * cierres), el cambio de hoy y la ganancia sobre el costo. El minigráfico es decorativo: los
 * números al lado dicen lo mismo en texto.
 */
export function TrendCard({ rows }: { rows: TrendRowView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tus posiciones</CardTitle>
        <CardDescription>Tendencia de los últimos 30 días</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y">
          {rows.map((row) => (
            <li key={row.symbol}>
              <Link
                href={row.href}
                className="flex items-center gap-3 py-2 active:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{row.symbol}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.name ?? ""}
                  </p>
                </div>
                <Sparkline values={row.spark} />
                <div className="w-24 shrink-0 text-right text-sm tabular-nums">
                  <p>
                    <span className="text-xs text-muted-foreground">Hoy </span>
                    <Pnl value={row.dayChangePct} kind="percent" />
                  </p>
                  <p>
                    <span className="text-xs text-muted-foreground">
                      Total{" "}
                    </span>
                    <Pnl value={row.unrealizedPct} kind="percent" />
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/positions" className="text-center text-sm underline">
          Ver todas las posiciones
        </Link>
      </CardContent>
    </Card>
  );
}
