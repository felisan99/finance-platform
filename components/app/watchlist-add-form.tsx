"use client";

import { useActionState } from "react";
import { Field } from "@/components/app/field";
import { Notice } from "@/components/app/stat";
import { SymbolCombobox } from "@/components/app/symbol-combobox";
import { Button } from "@/components/ui/button";
import {
  addToWatchlist,
  type WatchlistState,
} from "@/app/(app)/watchlist/actions";

const initialState: WatchlistState = { status: "idle" };

/** Seguir un símbolo nuevo: el mismo campo con autocompletado que usan las operaciones. */
export function WatchlistAddForm() {
  const [state, formAction, pending] = useActionState(
    addToWatchlist,
    initialState,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Field
        id="watchlist-symbol"
        label="Seguir un símbolo"
        error={state.status === "error" ? state.message : undefined}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {/* La clave cambia en cada alta exitosa: el campo se vacía. */}
            <SymbolCombobox
              key={state.status === "ok" ? state.at : "campo"}
              id="watchlist-symbol"
              name="symbol"
              defaultValue=""
              invalid={state.status === "error"}
              describedBy={
                state.status === "error" ? "watchlist-symbol-error" : undefined
              }
            />
          </div>
          <Button type="submit" size="lg" disabled={pending} className="h-8">
            {pending ? "Agregando…" : "Seguir"}
          </Button>
        </div>
      </Field>
      {state.status === "ok" && <Notice tone="info">{state.message}</Notice>}
    </form>
  );
}
