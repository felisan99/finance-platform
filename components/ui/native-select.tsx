import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * `<select>` nativo con el aspecto de `Input`: en el iPhone abre el selector del sistema, mucho
 * mejor que un menú desplegable propio.
 */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}
