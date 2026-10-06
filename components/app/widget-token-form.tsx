"use client";

import { useActionState, useState } from "react";
import {
  createWidgetToken,
  revokeWidgetToken,
  type WidgetFormState,
} from "@/app/(app)/more/widget/actions";
import { CopyButton } from "@/components/app/copy-button";
import { Notice } from "@/components/app/stat";
import { Button } from "@/components/ui/button";

const initial: WidgetFormState = { status: "idle" };

/**
 * Crear (o reemplazar) el código del widget. Vale para todos los portafolios: cada widget elige el
 * suyo con su campo «Parameter». El código recién creado se muestra una sola vez, con su botón para
 * copiarlo.
 */
export function WidgetTokenForm({ hasToken }: { hasToken: boolean }) {
  const [state, action, pending] = useActionState(createWidgetToken, initial);

  return (
    <div className="flex flex-col gap-3">
      {state.status === "created" && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Tu código</p>
          <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all select-all">
            {state.token}
          </code>
          <CopyButton text={state.token} label="Copiar código" />
          <Notice tone="warning">
            Copialo ahora y pegalo en Scriptable: no se vuelve a mostrar. Si lo
            perdés, creá otro.
          </Notice>
        </div>
      )}

      <form action={action} className="flex flex-col gap-3" noValidate>
        {state.status === "error" && (
          <Notice tone="error">{state.message}</Notice>
        )}
        {hasToken && (
          <p className="text-xs text-muted-foreground">
            Al crear uno nuevo, el código anterior deja de funcionar en todos
            tus widgets: hay que cargar el nuevo en Scriptable.
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending
            ? "Creando…"
            : hasToken
              ? "Crear un código nuevo"
              : "Crear mi código"}
        </Button>
      </form>
    </div>
  );
}

/** Revocar el código, en dos pasos (sin `confirm()` del navegador). */
export function RevokeWidgetTokenForm() {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState(revokeWidgetToken, initial);

  if (!asking) {
    return (
      <Button
        key="ask"
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => setAsking(true)}
      >
        Revocar el código
      </Button>
    );
  }

  return (
    <form key="confirm" action={action} className="flex flex-col gap-3">
      {state.status === "error" && (
        <Notice tone="error">{state.message}</Notice>
      )}
      <Notice tone="warning">
        El widget deja de actualizarse y va a pedir un código nuevo.
      </Notice>
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Revocando…" : "Sí, revocar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setAsking(false)}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
