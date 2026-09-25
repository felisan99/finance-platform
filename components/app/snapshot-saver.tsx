"use client";

import { useEffect } from "react";
import { saveSnapshot } from "@/lib/portfolio/snapshot-storage";

/**
 * Deja en el dispositivo el último estado de Inicio (texto ya formateado, sin datos de la base)
 * para mostrarlo en la pantalla sin conexión. No dibuja nada.
 */
export function SnapshotSaver({ json }: { json: string }) {
  useEffect(() => {
    saveSnapshot(json);
  }, [json]);
  return null;
}
