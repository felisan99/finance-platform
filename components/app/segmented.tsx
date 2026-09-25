"use client";

import { cn } from "@/lib/utils";

/**
 * Selector de una opción entre pocas (período, modo de un gráfico), con botones que ocupan el ancho
 * disponible. Cada botón lleva `aria-pressed`: para un lector de pantalla es un grupo de opciones.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; text: string; disabled?: boolean }>;
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 rounded-lg bg-muted p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
          className={cn(
            "h-8 flex-1 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            option.id === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}
