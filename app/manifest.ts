import type { MetadataRoute } from "next";

// Manifiesto de la PWA (spec §10.6). Next lo sirve en /manifest.webmanifest. Los colores son los de
// la app en modo claro; el modo oscuro lo resuelven las metaetiquetas `theme-color` del layout.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Portfolio Tracker",
    short_name: "Portfolio",
    description: "Seguimiento de tu portafolio de inversiones",
    lang: "es",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["finance"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
