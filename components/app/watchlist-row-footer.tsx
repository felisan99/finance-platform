"use client";

import { X } from "lucide-react";
import { useActionState, useState, type ReactNode } from "react";
import { Notice } from "@/components/app/stat";
import { Button } from "@/components/ui/button";
import {
  removeFromWatchlist,
  type WatchlistState,
} from "@/app/(app)/watchlist/actions";

const initialState: WatchlistState = { status: "idle" };

/**
 * Pie de una fila de la watchlist: el minigráfico y el rango (`children`, armados en el servidor)
 * con el botón de quitar al lado. Quitar es en dos pasos ("¿Quitar?"), sin `window.confirm`. Los
 * botones van sobre el enlace que cubre toda la tarjeta (`z-10`); el resto del pie deja pasar el
 * toque al enlace.
 */
export function WatchlistRowFooter({
  symbol,
  children,
}: {
  symbol: string;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    removeFromWatchlist,
    initialState,
  );

  return (
    <div className="mt-2 flex flex-col gap-2">
      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="symbol" value={symbol} />
        {/* Cada rama tiene su propia `key`: sin ella React reutilizaría el <button> de "Quitar"
            (type="button") como "Sí, quitar" (type="submit") en medio del mismo clic, y el
            navegador enviaría el formulario sin la confirmación. */}
        {confirming ? (
          <div key="confirmar" className="flex flex-1 items-center gap-3">
            <p className="min-w-0 flex-1 text-sm">¿Quitar {symbol}?</p>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending}
              className="relative z-10 h-9"
            >
              {pending ? "Quitando…" : "Sí, quitar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              className="relative z-10 h-9"
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <div key="reposo" className="flex min-w-0 flex-1 items-center gap-3">
            {children}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Quitar ${symbol} de la watchlist`}
              onClick={() => setConfirming(true)}
              className="relative z-10 size-11 text-muted-foreground"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        )}
      </form>
      {state.status === "error" && (
        <Notice tone="error" className="relative z-10">
          {state.message}
        </Notice>
      )}
    </div>
  );
}
