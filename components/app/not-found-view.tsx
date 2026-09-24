import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Pantalla de "no encontrado" en español (la de Next por defecto está en inglés). */
export function NotFoundView() {
  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <h1 className="text-xl font-semibold">No encontramos esa página</h1>
      <p className="text-sm text-muted-foreground">
        Puede que la dirección esté mal escrita, o que la operación o la
        posición ya no exista.
      </p>
      <Link href="/" className={buttonVariants()}>
        Volver al inicio
      </Link>
    </div>
  );
}
