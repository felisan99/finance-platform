"use client";

import { useEffect } from "react";
import { clearSnapshot } from "@/lib/portfolio/snapshot-storage";

/** En /login: sesión cerrada o vencida (o alguien más entrando): se borra el estado guardado. */
export function ClearSnapshot() {
  useEffect(() => {
    clearSnapshot();
  }, []);
  return null;
}
