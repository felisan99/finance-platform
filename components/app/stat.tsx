import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Un dato con su rótulo, en una tarjeta chica (Inicio y detalle de posición). */
export function Stat({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={className}>
      <CardContent className="flex flex-col gap-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-base font-semibold tabular-nums">{children}</p>
        {hint && (
          <p className="text-xs text-muted-foreground tabular-nums">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  context,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Arriba del título: el portafolio que se está mirando (selector o texto). */
  context?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 pb-4">
      <div className="min-w-0">
        {context && <div className="pb-1">{context}</div>}
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

const TONES = {
  warning: "bg-warning text-warning-foreground",
  error: "bg-destructive/10 text-destructive",
  info: "bg-muted text-foreground",
} as const;

/** Aviso en una línea o dos. Los errores se anuncian (`alert`); lo demás es informativo (`status`). */
export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg px-3 py-2 text-sm", TONES[tone], className)}
    >
      {children}
    </p>
  );
}
