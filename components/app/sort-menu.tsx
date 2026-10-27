import Link from "next/link";
import { DismissibleDetails } from "@/components/app/dismissible-details";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * «Ordenar: Valor ▾»: un menú desplegable de enlaces (`<details>`), así el orden vive en la URL, la
 * página se arma en el servidor y anda sin JavaScript. Con JavaScript se cierra al tocar afuera o
 * con Escape (`DismissibleDetails`). `<details>` guarda en el DOM si está abierto: la `key` con el
 * orden elegido lo vuelve a crear al navegar, así el menú se cierra al elegir.
 *
 * La lista va encima de las filas (`absolute`, `z-20`, fondo opaco `bg-popover`): ningún contenedor
 * de la página de posiciones recorta con `overflow`; si se mueve a uno que sí, hay que revisarlo.
 */
export function SortMenu({
  label,
  current,
  options,
}: {
  /** Para lectores de pantalla: qué se ordena. */
  label: string;
  current: string;
  options: ReadonlyArray<{ id: string; text: string; href: string }>;
}) {
  const selected = options.find((option) => option.id === current);
  return (
    <nav aria-label={label} className="self-start">
      <DismissibleDetails key={current} className="relative">
        <summary className="cursor-pointer list-none rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
          <span className={buttonVariants({ variant: "outline", size: "sm" })}>
            <span className="text-muted-foreground">Ordenar:</span>
            {selected?.text}
            <span aria-hidden="true" className="text-muted-foreground">
              ▾
            </span>
          </span>
        </summary>
        <ul className="absolute top-full left-0 z-20 mt-1 flex min-w-40 flex-col rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          {options.map((option) => (
            <li key={option.id}>
              <Link
                href={option.href}
                aria-current={option.id === current ? "true" : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm active:bg-muted",
                  option.id === current && "font-semibold",
                )}
              >
                {option.text}
                {option.id === current && <span aria-hidden="true">✓</span>}
              </Link>
            </li>
          ))}
        </ul>
      </DismissibleDetails>
    </nav>
  );
}
