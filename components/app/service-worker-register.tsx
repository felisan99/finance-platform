"use client";

import { useEffect } from "react";

/**
 * Registra el service worker de la app instalable (`public/sw.js`). Solo en producción: en
 * desarrollo un service worker se mete con el recargado en caliente. Si el navegador no lo
 * soporta o falla, la app funciona igual (solo se pierde la pantalla sin conexión).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => {
        console.error("[sw] no se pudo registrar", error);
      });
  }, []);
  return null;
}
