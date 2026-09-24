"use client";

import { useActionState, useState } from "react";
import { Notice } from "@/components/app/stat";
import { Button } from "@/components/ui/button";
import {
  deleteTransaction,
  type FormState,
} from "@/app/(app)/activity/actions";

const initialState: FormState = { status: "idle" };

/** Eliminar en dos pasos ("¿Seguro?"), sin `window.confirm`. */
export function DeleteTransactionButton({
  id,
  imported,
}: {
  id: string;
  imported: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    deleteTransaction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      {state.status === "error" && state.message && (
        <Notice tone="error">{state.message}</Notice>
      )}
      {!confirming ? (
        <Button
          type="button"
          variant="destructive"
          size="lg"
          onClick={() => setConfirming(true)}
        >
          Eliminar operación
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            ¿Seguro? Esta operación se borra y los números se recalculan.
            {imported &&
              " Si volvés a importar el archivo original, se va a crear de nuevo."}
          </p>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              size="lg"
              disabled={pending}
              className="flex-1"
            >
              {pending ? "Eliminando…" : "Sí, eliminar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setConfirming(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
