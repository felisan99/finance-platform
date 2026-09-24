"use client";

import { Button } from "@/components/ui/button";

/** Si falla la carga de una pantalla (base caída, dato inconsistente), un mensaje y reintentar. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-8" role="alert">
      <h1 className="text-lg font-semibold">No pudimos cargar esta pantalla</h1>
      <p className="text-sm text-muted-foreground">
        Puede ser algo pasajero. Probá de nuevo; si sigue igual, avisá.
        {error.digest && (
          <span className="block text-xs">Código: {error.digest}</span>
        )}
      </p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
