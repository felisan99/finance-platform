import Link from "next/link";
import { PageHeader } from "@/components/app/stat";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { cn } from "@/lib/utils";
import { signOut } from "../actions";

export default async function MorePage() {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Más" />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Tu cuenta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="truncate text-sm">{user?.email ?? "Sin email"}</p>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="w-full">
              Cerrar sesión
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Portafolios</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Separá tus inversiones, por ejemplo acciones por un lado y cripto
            por otro.
          </p>
          <Link
            href="/more/portfolios"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Administrar portafolios
          </Link>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Widget para iPhone</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Tu valor total y el cambio del día en la pantalla de inicio, con la
            app gratuita Scriptable.
          </p>
          <Link
            href="/more/widget"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Configurar el widget
          </Link>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Tus datos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Link
            href="/activity/import"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Importar operaciones (CSV)
          </Link>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- descarga de un archivo: <Link> intentaría navegar */}
          <a
            href="/activity/export"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Exportar las operaciones (CSV)
          </a>
          <Link
            href="/activity/new"
            className={cn(buttonVariants({ variant: "outline" }), "w-full")}
          >
            Agregar una operación
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
