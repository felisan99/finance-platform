"use client";

import { useId, useTransition } from "react";
import { NativeSelect } from "@/components/ui/native-select";
import { selectPortfolio } from "@/app/(app)/more/portfolios/actions";
import { cn } from "@/lib/utils";

/**
 * Selector de lo que se está mirando (Inicio, Posiciones y Actividad): «Todos los portafolios» o
 * uno. Es un `<select>` nativo: en el iPhone abre el selector del sistema. Al elegir, el servidor
 * recuerda la elección en una cookie y vuelve a dibujar la pantalla. Quien lo usa le pone
 * `key={current}`, así el valor se reinicia si el servidor cambia lo elegido (por ejemplo, porque
 * se borró el portafolio).
 */
export function PortfolioSwitcher({
  options,
  current,
}: {
  /** `value`: el id del portafolio, o `all` para «Todo junto». */
  options: ReadonlyArray<{ value: string; label: string }>;
  current: string;
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
        defaultValue={current}
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
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
