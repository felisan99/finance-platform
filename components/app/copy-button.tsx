"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type CopyStatus = "idle" | "copied" | "failed";

/**
 * Copia un texto al portapapeles. Si el navegador no lo permite, avisa cómo copiarlo a mano (el
 * texto queda a la vista, en un campo seleccionable).
 */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        className={className}
        onClick={copy}
      >
        {status === "copied" ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        {status === "copied" ? "Copiado" : label}
      </Button>
      <p role="status" className="text-xs text-muted-foreground">
        {status === "failed"
          ? "No se pudo copiar: mantené apretado el texto y elegí Copiar."
          : null}
      </p>
    </div>
  );
}
