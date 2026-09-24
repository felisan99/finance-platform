"use client";

import { ArrowLeftRight, ChartPie, Ellipsis, House } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Inicio", icon: House },
  { href: "/positions", label: "Posiciones", icon: ChartPie },
  { href: "/activity", label: "Actividad", icon: ArrowLeftRight },
  { href: "/more", label: "Más", icon: Ellipsis },
] as const;

/**
 * Navegación inferior fija, a lo ancho de la columna de la app. Respeta el área segura del iPhone
 * (`env(safe-area-inset-bottom)`, requiere `viewport-fit=cover`). La pestaña de Watchlist llega con
 * la Fase 6.
 */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 text-xs font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon
                  className="size-5"
                  strokeWidth={active ? 2.5 : 2}
                  aria-hidden="true"
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
