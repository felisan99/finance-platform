"use client";

import { RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { refreshQuotesAction, type RefreshState } from "@/app/(app)/actions";

const initial: RefreshState = { status: "idle" };

/** "Actualizar precios": pide cotizaciones nuevas de tus posiciones (1 vez cada 5 minutos). */
export function RefreshButton() {
  const [state, formAction, pending] = useActionState(
    refreshQuotesAction,
    initial,
  );
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <RefreshCw
          className={pending ? "animate-spin" : undefined}
          aria-hidden="true"
        />
        {pending ? "Actualizando…" : "Actualizar precios"}
      </Button>
      {state.status !== "idle" && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "max-w-56 text-right text-xs text-destructive"
              : "max-w-56 text-right text-xs text-muted-foreground"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
