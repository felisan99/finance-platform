import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BottomNav } from "@/components/app/bottom-nav";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  // El proxy ya redirige sin sesión; se verifica de nuevo acá porque el proxy no es una barrera.
  if (!(await getSessionUser(supabase))) redirect("/login");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      {/* Espacio para la navegación fija de abajo + el área segura del iPhone. */}
      <main className="flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
