import type { ReactNode } from "react";
import { Pnl } from "@/components/app/pnl";
import { Notice } from "@/components/app/stat";
import { Card, CardContent } from "@/components/ui/card";
import type { Dec, PriceSource } from "@/lib/engine";
import { formatDayMonth, formatPrice } from "@/lib/portfolio/format";

/** Lo que muestra la tarjeta: el precio de hoy y su cambio (de la posición o del símbolo). */
export interface PriceCardData {
  price: Dec | null;
  priceSource: PriceSource | null;
  priceAsOf: Date | null;
  dayChange: Dec | null;
  dayChangePct: Dec | null;
}

/**
 * Tarjeta de arriba de la ficha de un activo: el precio, el cambio de hoy y de cuándo es el precio.
 * La comparten la posición (abierta o cerrada) y el símbolo que solo se sigue. Sin precio muestra
 * `missing` (cada pantalla dice qué hacer). `status` es una línea chica debajo («Posición cerrada»).
 */
export function PriceCard({
  data,
  missing,
  status,
}: {
  data: PriceCardData;
  missing: ReactNode;
  status?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        {data.price !== null ? (
          <>
            <p className="text-sm text-muted-foreground">Precio</p>
            <p className="text-3xl font-semibold tabular-nums">
              {formatPrice(data.price, { currency: true })}
            </p>
            <p className="text-sm">
              <Pnl
                value={data.dayChange}
                kind="money"
                percent={data.dayChangePct}
              />{" "}
              <span className="text-muted-foreground">hoy</span>
            </p>
            {data.priceAsOf && (
              <p className="text-xs text-muted-foreground">
                {data.priceSource === "close" ? "Último cierre" : "Precio"} al{" "}
                {formatDayMonth(data.priceAsOf)}
              </p>
            )}
          </>
        ) : (
          <Notice tone="warning">{missing}</Notice>
        )}
        {status && (
          <p className="pt-1 text-xs text-muted-foreground">{status}</p>
        )}
      </CardContent>
    </Card>
  );
}
