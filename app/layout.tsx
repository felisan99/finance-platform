import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/app/service-worker-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portfolio Tracker",
  description: "Seguimiento de tu portafolio de inversiones",
  applicationName: "Portfolio Tracker",
  // "Agregar a pantalla de inicio" en el iPhone: se abre sin la barra del navegador. La barra de
  // estado es la del sistema (`default`); `black-translucent` obligaría a texto blanco fijo.
  appleWebApp: { capable: true, title: "Portfolio", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  // Sin enlaces automáticos de teléfono, correo o dirección sobre los números.
  formatDetection: { telephone: false, email: false, address: false },
  // Next emite solo `mobile-web-app-capable`; Safari en iPhone sigue leyendo la variante de Apple.
  other: { "apple-mobile-web-app-capable": "yes" },
};

// `viewport-fit=cover` hace que `env(safe-area-inset-*)` valga en el iPhone (notch y barra inferior).
// `themeColor` con dos valores: el color de la barra sigue al modo claro u oscuro del sistema.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* Franja opaca bajo la barra de estado del iPhone (la app usa `viewport-fit=cover`): el
            sistema desenfoca lo que pasa por debajo, y el texto se veía borroso ahí arriba. Fuera de
            la app instalada mide 0. */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[env(safe-area-inset-top)] bg-background"
        />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
