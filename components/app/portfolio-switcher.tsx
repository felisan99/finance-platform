"use client";

import { useId, useTransition } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { selectPortfolio } from "@/app/(app)/more/portfolios/actions";
import { cn } from "@/lib/utils";

/**
 * Selector del portafolio que se está mirando (Inicio, Posiciones y Actividad). Es un `<select>`
 * nativo: en el iPhone abre el selector del sistema. Al elegir, el servidor recuerda la elección en
 * una cookie y vuelve a dibujar la pantalla. Quien lo usa le pone `key={currentId}`, así el valor
 * se reinicia si el servidor cambia el portafolio (por ejemplo, porque se borró).
 */
export function PortfolioSwitcher({
  portfolios,
  currentId,
}: {
  portfolios: ReadonlyArray<{ id: string; name: string }>;
  currentId: string;
}) {
  const id = useId();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Portafolio
      </label>
      <NativeSelect
        id={id}
        defaultValue={currentId}
        disabled={pending}
        aria-busy={pending || undefined}
        onChange={(event) => {
          const formData = new FormData();
          formData.set("portfolio", event.target.value);
          startTransition(() => selectPortfolio(formData));
        }}
        className={cn(
          "h-8 w-auto max-w-full truncate font-medium",
          pending && "opacity-60",
        )}
      >
        {portfolios.map((portfolio) => (
          <option key={portfolio.id} value={portfolio.id}>
            {portfolio.name}
          </option>
        ))}
      </NativeSelect>
      {pending && (
        <span role="status" className="text-xs text-muted-foreground">
          Cargando…
        </span>
      )}
    </div>
  );
}
