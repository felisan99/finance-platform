"use client";

import {
  ChartPie,
  Ellipsis,
  House,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Otras rutas que marcan la pestaña como activa (Actividad vive dentro de "Más"). */
  alsoActive?: readonly string[];
}

const LEFT: readonly Tab[] = [
  { href: "/", label: "Inicio", icon: House },
  { href: "/positions", label: "Posiciones", icon: ChartPie },
];
const RIGHT: readonly Tab[] = [
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/more", label: "Más", icon: Ellipsis, alsoActive: ["/activity"] },
];
const ASSISTANT = "/assistant";

const isActive = (pathname: string, tab: Tab): boolean =>
  tab.href === "/"
    ? pathname === "/"
    : [tab.href, ...(tab.alsoActive ?? [])].some((href) =>
        pathname.startsWith(href),
      );

/**
 * Navegación inferior fija, a lo ancho de la columna de la app: dos pestañas a cada lado y el
 * asistente como botón circular en el medio. Respeta el área segura del iPhone
 * (`env(safe-area-inset-bottom)`, requiere `viewport-fit=cover`).
 */
export function BottomNav() {
  const pathname = usePathname();
  const assistantActive = pathname.startsWith(ASSISTANT);

  const tab = ({ href, label, icon: Icon, ...rest }: Tab) => {
    const active = isActive(pathname, { href, label, icon: Icon, ...rest });
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
  };

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto flex max-w-2xl items-end">
        {LEFT.map(tab)}
        <li className="flex flex-1 justify-center">
          <Link
            href={ASSISTANT}
            aria-current={assistantActive ? "page" : undefined}
            className="flex min-h-14 flex-col items-center justify-end gap-0.5 pb-1 text-xs font-medium"
          >
            <span
              className={cn(
                "-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform active:scale-95",
                assistantActive && "ring-primary/30",
              )}
            >
              <Sparkles className="size-6" aria-hidden="true" />
            </span>
            <span
              className={
                assistantActive ? "text-foreground" : "text-muted-foreground"
              }
            >
              Asistente
            </span>
          </Link>
        </li>
        {RIGHT.map(tab)}
      </ul>
    </nav>
  );
}
