import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildEarningsView, type Verdict } from "@/lib/portfolio/earnings-view";
import { loadCompanyData } from "@/lib/portfolio/company-data";
import { cn } from "@/lib/utils";

const VERDICT_CLASS: Record<Verdict, string> = {
  beat: "border-gain text-gain",
  inline: "border-border text-muted-foreground",
  miss: "border-loss text-loss",
};

/**
 * Tarjeta «Ganancias»: el BPA real de los últimos trimestres contra el consenso de los analistas,
 * con el veredicto en texto (no solo color). Solo acciones; un ETF o una acción sin trimestres
 * publicados no tiene tarjeta. Las barras son de SVG/CSS: son cuatro y no hace falta un gráfico.
 */
export async function EarningsCard({
  providerSymbol,
  kind,
}: {
  providerSymbol: string;
  kind: "stock" | "etf";
}) {
  if (kind !== "stock") return null;
  const data = await loadCompanyData(providerSymbol, kind);
  const view = data === null ? null : buildEarningsView(data, new Date());
  if (view === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Ganancias</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="grid grid-cols-4 gap-2">
          {view.bars.map((bar) => (
            <li
              key={bar.label}
              className="flex min-w-0 flex-col items-center gap-1.5"
              aria-label={bar.summary}
            >
              <span className="text-[0.7rem] font-medium tabular-nums">
                {bar.actualText}
              </span>
              <div
                aria-hidden="true"
                className="relative h-28 w-full border-b border-border"
              >
                <div
                  className={cn(
                    "absolute inset-x-[22%] rounded-sm",
                    bar.negative ? "bg-loss/70" : "bg-foreground/70",
                  )}
                  style={{ top: `${bar.top}%`, height: `${bar.height}%` }}
                />
                {bar.estimateY !== null && (
                  <div
                    className="absolute inset-x-[10%] h-0.5 rounded-full bg-muted-foreground"
                    style={{ top: `calc(${bar.estimateY}% - 1px)` }}
                  />
                )}
              </div>
              <span className="text-[0.7rem] text-muted-foreground">
                {bar.label}
              </span>
              {bar.verdictText !== null && bar.verdict !== null ? (
                <Badge
                  variant="outline"
                  className={cn("text-[0.65rem]", VERDICT_CLASS[bar.verdict])}
                >
                  {bar.verdictText}
                </Badge>
              ) : (
                <span className="h-5" aria-hidden="true" />
              )}
              <span className="h-4 text-[0.65rem] text-muted-foreground tabular-nums">
                {bar.diffText}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          <span aria-hidden="true">━</span> Consenso de los analistas (BPA
          esperado). Trimestres por su fecha de cierre.
          {view.nextText && <> {view.nextText}.</>}
        </p>
      </CardContent>
    </Card>
  );
}
