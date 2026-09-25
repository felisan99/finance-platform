import type { NextConfig } from "next";
import { CONTENT_SECURITY_POLICY } from "./lib/security/csp";

// Cabeceras de seguridad para toda la app. La CSP estricta (con nonces) queda para la Fase 7,
// junto con el dominio propio; mientras tanto va la intermedia de lib/security/csp.ts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Sin ventanas que compartan proceso con otro origen (aísla la app de las páginas que la abran).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // App privada: que los buscadores no la indexen ni guarden copias.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // La CSP solo en producción: el modo desarrollo de Next necesita `eval` y WebSocket para el
    // refresco en caliente y una política así lo rompería.
    const csp =
      process.env.NODE_ENV === "production"
        ? [{ key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY }]
        : [];
    return [
      { source: "/:path*", headers: [...securityHeaders, ...csp] },
      {
        // El service worker no se cachea (una versión vieja se quedaría pegada) y solo puede
        // cargar scripts de este mismo origen.
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
