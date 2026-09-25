import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Cuando todavía no hay operaciones: los dos caminos para empezar. */
export function EmptyPortfolio() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Todavía no cargaste operaciones</CardTitle>
        <CardDescription>
          Importá tu historial desde un CSV (el de Delta o nuestra plantilla) o
          cargá tu primera operación a mano.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/activity/import"
          className={cn(buttonVariants({ size: "lg" }), "flex-1")}
        >
          Importar un CSV
        </Link>
        <Link
          href="/activity/new"
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "flex-1",
          )}
        >
          Agregar una operación
        </Link>
      </CardContent>
    </Card>
  );
}
