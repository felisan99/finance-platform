// Service worker de la app instalable (spec §10.6). Es a propósito mínimo:
//  * NO guarda páginas ni datos: son personales y financieros, y quedarían viejos sin aviso.
//  * Solo guarda la pantalla "sin conexión" y sus archivos, para mostrarla cuando una navegación
//    falla por falta de red. Las acciones del servidor y las lecturas de datos no pasan por acá.
// Al cambiar cualquiera de los archivos precacheados, subir VERSION.
const VERSION = "v3";
const CACHE = `pt-shell-${VERSION}`;
const OFFLINE_URL = "/pwa/offline.html";
const PRECACHE = [
  OFFLINE_URL,
  "/pwa/offline.css",
  "/pwa/offline.js",
  "/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("pt-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Los archivos de la pantalla sin conexión salen del caché (con la red caída no hay otra fuente).
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request)),
    );
    return;
  }

  // Una navegación (abrir la app, tocar un enlace completo) que falla por falta de red muestra la
  // pantalla sin conexión. Las respuestas del servidor, incluso de error, se dejan pasar tal cual.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (
          (await cache.match(OFFLINE_URL)) ||
          new Response("Sin conexión", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
  }
});
