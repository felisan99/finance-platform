"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Un `<details>` que se cierra al tocar o hacer clic afuera y con Escape (el nativo solo se cierra
 * tocando su `<summary>`; en el iPhone el menú quedaba abierto encima de la lista). El contenido
 * llega del servidor tal cual: sin JavaScript sigue andando, solo que sin este cierre.
 */
export function DismissibleDetails({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const details = ref.current;
      if (!details?.open) return;
      if (event.target instanceof Node && details.contains(event.target)) {
        return;
      }
      details.open = false;
    }
    function onKeyDown(event: KeyboardEvent) {
      const details = ref.current;
      if (event.key !== "Escape" || !details?.open) return;
      details.open = false;
      // El foco vuelve al botón que abrió el menú.
      details.querySelector("summary")?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}
