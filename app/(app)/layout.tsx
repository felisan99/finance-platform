import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/db/server";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  // El proxy ya redirige sin sesión; se verifica de nuevo acá porque el proxy no es una barrera.
  if (!data?.claims) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="truncate text-sm text-muted-foreground">
          {data.claims.email}
        </span>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Cerrar sesión
          </Button>
        </form>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
