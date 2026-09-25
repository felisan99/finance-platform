"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/app/stat";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/portfolio/plural";
import {
  undoImport,
  type UndoState,
} from "@/app/(app)/activity/import/actions";

// Importaciones anteriores. El servidor manda todo ya escrito (fechas, cantidades): el cliente solo
// maneja el «Deshacer» en dos pasos (sin `confirm()` del navegador).

export interface ImportHistoryItem {
  id: string;
  filename: string;
  formatLabel: string;
  /** `09/03/2026 19:34`, en hora de Montevideo. */
  when: string;
  /** Cuántas operaciones quedan ligadas hoy a esta importación. */
  liveCount: number;
  /** `active`: se puede deshacer; `undone`: ya se deshizo; `empty`: no queda nada para deshacer. */
  status: "active" | "undone" | "empty";
  /** Cuándo se deshizo (solo con `undone`). */
  undoneWhen: string | null;
}

const initial: UndoState = { status: "idle" };

function UndoControl({ item }: { item: ImportHistoryItem }) {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState(undoImport, initial);

  if (state.status === "done") {
    return (
      <p className="text-xs text-muted-foreground">
        Listo: se {plural(state.deleted, "borró", "borraron")} {state.deleted}{" "}
        {plural(state.deleted, "operación", "operaciones")}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {state.status === "error" && (
        <Notice tone="error">{state.message}</Notice>
      )}
      {asking ? (
        <form key="confirm" action={action} className="flex flex-col gap-2">
          <input type="hidden" name="importId" value={item.id} />
          <p className="text-xs">
            ¿Seguro? Se{" "}
            {plural(
              item.liveCount,
              "borra la operación que queda",
              `borran las ${item.liveCount} operaciones que quedan`,
            )}{" "}
            de esta importación. Lo que cargaste a mano no se toca.
          </p>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={pending}
            >
              {pending ? "Deshaciendo…" : "Sí, deshacer"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setAsking(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <Button
          key="ask"
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAsking(true)}
        >
          Deshacer importación
        </Button>
      )}
    </div>
  );
}

export function ImportHistory({ items }: { items: ImportHistoryItem[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate font-medium">
              {item.filename}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {item.when}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Formato {item.formatLabel}
            {item.status === "active" &&
              ` · ${item.liveCount} ${plural(item.liveCount, "operación", "operaciones")}`}
            {item.status === "undone" && ` · deshecha el ${item.undoneWhen}`}
            {item.status === "empty" &&
              " · sin operaciones para deshacer (anterior a esta función, o ya las borraste)"}
          </p>
          {item.status === "active" && <UndoControl item={item} />}
        </li>
      ))}
    </ul>
  );
}
