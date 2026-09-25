import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";
import nextConfig from "@/next.config";
import { CONTENT_SECURITY_POLICY } from "@/lib/security/csp";

// La app instalable (spec §10.6): el manifiesto, los íconos, el service worker y las cabeceras.
// Lo que solo se ve en un navegador real (instalabilidad, sin conexión, modo oscuro) lo comprueba
// la prueba con Chrome del cierre de la fase.

const root = process.cwd();
/** La versión del caché sale del propio sw.js: subirla no rompe los tests. */
const CACHE = `pt-shell-${readFileSync(resolve(root, "public/sw.js"), "utf8").match(/const VERSION = "([^"]+)"/)![1]}`;
const publicFile = (path: string) =>
  resolve(root, "public", path.replace(/^\//, ""));

/** Ancho y alto de un PNG (cabecera IHDR, big-endian). */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("manifiesto", () => {
  const m = manifest();

  it("se abre como una app: standalone, desde la raíz, en español", () => {
    expect(m).toMatchObject({
      display: "standalone",
      start_url: "/",
      scope: "/",
      id: "/",
      lang: "es",
      name: "Portfolio Tracker",
    });
    expect(m.short_name!.length).toBeLessThanOrEqual(12); // debajo del ícono en la pantalla de inicio
  });

  it("los colores son hex válidos", () => {
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("tiene íconos 192 y 512 y uno maskable, y los archivos existen con ese tamaño", () => {
    const icons = m.icons ?? [];
    const find = (size: string, purpose: string) =>
      icons.find((i) => i.sizes === size && i.purpose === purpose);
    expect(find("192x192", "any")).toBeDefined();
    expect(find("512x512", "any")).toBeDefined();
    expect(find("512x512", "maskable")).toBeDefined();
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      const file = publicFile(icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const { width, height } = pngSize(file);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it("el ícono de iOS es de 180 × 180", () => {
    expect(pngSize(publicFile("/icons/apple-touch-icon.png"))).toEqual({
      width: 180,
      height: 180,
    });
  });
});

describe("cabeceras (next.config)", () => {
  it("toda la app lleva las cabeceras de seguridad básicas", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");
    const headers = Object.fromEntries(
      all!.headers.map((h) => [h.key, h.value]),
    );
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("geolocation=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["X-Robots-Tag"]).toContain("noindex");
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  describe("Content-Security-Policy", () => {
    const allHeaders = async () => {
      const rules = await nextConfig.headers!();
      const all = rules.find((rule) => rule.source === "/:path*");
      return Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    };
    afterEach(() => vi.unstubAllEnvs());

    it("en producción toda la app la lleva", async () => {
      vi.stubEnv("NODE_ENV", "production");
      expect((await allHeaders())["Content-Security-Policy"]).toBe(
        CONTENT_SECURITY_POLICY,
      );
    });

    it("en desarrollo no: el refresco en caliente de Next necesita eval y WebSocket", async () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(await allHeaders()).not.toHaveProperty("Content-Security-Policy");
    });
  });

  it("el service worker no se cachea y solo carga scripts propios", async () => {
    const rules = await nextConfig.headers!();
    const sw = rules.find((rule) => rule.source === "/sw.js");
    const headers = Object.fromEntries(
      sw!.headers.map((h) => [h.key, h.value]),
    );
    expect(headers["Cache-Control"]).toContain("no-cache");
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["Content-Type"]).toContain("javascript");
    expect(headers["Content-Security-Policy"]).toContain("script-src 'self'");
    expect(headers["Service-Worker-Allowed"]).toBe("/");
  });
});

// --- El service worker, ejecutado con un entorno de mentira ---

type Listener = (event: FakeEvent) => void;
interface FakeEvent {
  request?: { method: string; url: string; mode: string };
  waitUntil?: (promise: Promise<unknown>) => void;
  respondWith?: (response: Promise<Response> | Response) => void;
}

class FakeCache {
  readonly entries = new Map<string, Response>();
  puts = 0;
  async addAll(urls: string[]) {
    for (const url of urls) this.entries.set(url, new Response(`caché:${url}`));
  }
  async match(request: string | { url: string }) {
    const url =
      typeof request === "string" ? request : new URL(request.url).pathname;
    return this.entries.get(url);
  }
  async put() {
    this.puts++;
  }
}

function loadServiceWorker(options: {
  network: (url: string) => Promise<Response>;
}) {
  const source = readFileSync(publicFile("/sw.js"), "utf8");
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, FakeCache>();
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new FakeCache());
    return stores.get(name)!;
  };
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: { url: string }) => {
      for (const store of stores.values()) {
        const hit = await store.match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    location: { origin: "https://app.example" },
    addEventListener: (name: string, fn: Listener) => listeners.set(name, fn),
    skipWaiting: async () => void calls.skipWaiting++,
    clients: { claim: async () => void calls.claim++ },
  };
  const fetchStub = (request: { url: string }) => options.network(request.url);
  new Function("self", "caches", "fetch", "URL", "Response", source)(
    self,
    caches,
    fetchStub,
    URL,
    Response,
  );
  return { listeners, stores, open, calls };
}

async function dispatch(listener: Listener | undefined, event: FakeEvent) {
  let waited: Promise<unknown> | undefined;
  let responded: Promise<Response> | Response | undefined;
  listener!({
    ...event,
    waitUntil: (p) => (waited = p),
    respondWith: (r) => (responded = r),
  });
  if (waited) await waited;
  return {
    handled: responded !== undefined,
    response: responded ? await responded : undefined,
  };
}

const nav = (path: string) => ({
  method: "GET",
  url: `https://app.example${path}`,
  mode: "navigate",
});

describe("service worker (public/sw.js)", () => {
  const online = async () => new Response("página", { status: 200 });
  const offline = async (): Promise<Response> => {
    throw new TypeError("Failed to fetch");
  };

  it("todo lo que precachea existe en public/", () => {
    const source = readFileSync(publicFile("/sw.js"), "utf8");
    const block = source.match(/const PRECACHE = \[([\s\S]*?)\];/)![1]!;
    // La lista arranca con la constante OFFLINE_URL y sigue con rutas escritas a mano.
    const offlineUrl = source.match(/const OFFLINE_URL = "([^"]+)"/)![1]!;
    const paths = [
      offlineUrl,
      ...[...block.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]!),
    ];
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const path of paths)
      expect(existsSync(publicFile(path)), path).toBe(true);
    expect(paths).toContain("/pwa/offline.html");
  });

  it("al instalar guarda la pantalla sin conexión y sus archivos", async () => {
    const sw = loadServiceWorker({ network: online });
    await dispatch(sw.listeners.get("install"), {});
    const cache = sw.open(CACHE);
    expect([...cache.entries.keys()].sort()).toEqual([
      "/icons/icon-192.png",
      "/pwa/offline.css",
      "/pwa/offline.html",
      "/pwa/offline.js",
    ]);
  });

  it("una versión nueva toma el control enseguida (skipWaiting al instalar, claim al activar)", async () => {
    const sw = loadServiceWorker({ network: online });
    await dispatch(sw.listeners.get("install"), {});
    expect(sw.calls.skipWaiting).toBe(1);
    await dispatch(sw.listeners.get("activate"), {});
    expect(sw.calls.claim).toBe(1);
  });

  it("al activar borra los cachés viejos de la app y no toca los ajenos", async () => {
    const sw = loadServiceWorker({ network: online });
    sw.open("pt-shell-v0");
    sw.open(CACHE);
    sw.open("otra-cosa");
    await dispatch(sw.listeners.get("activate"), {});
    expect([...sw.stores.keys()].sort()).toEqual(["otra-cosa", CACHE]);
  });

  it("una navegación con red pasa tal cual", async () => {
    const sw = loadServiceWorker({ network: online });
    const { handled, response } = await dispatch(sw.listeners.get("fetch"), {
      request: nav("/positions"),
    });
    expect(handled).toBe(true);
    expect(await response!.text()).toBe("página");
  });

  it("una navegación sin red muestra la pantalla sin conexión del caché", async () => {
    const sw = loadServiceWorker({ network: offline });
    await dispatch(sw.listeners.get("install"), {});
    const { response } = await dispatch(sw.listeners.get("fetch"), {
      request: nav("/positions"),
    });
    expect(await response!.text()).toBe("caché:/pwa/offline.html");
  });

  it("sin red y sin la pantalla en el caché, responde un 503 en texto (no rompe)", async () => {
    const sw = loadServiceWorker({ network: offline });
    const { response } = await dispatch(sw.listeners.get("fetch"), {
      request: nav("/"),
    });
    expect(response!.status).toBe(503);
  });

  it("un error del servidor (500, 404) NO se reemplaza por la pantalla sin conexión", async () => {
    const sw = loadServiceWorker({
      network: async () => new Response("boom", { status: 500 }),
    });
    await dispatch(sw.listeners.get("install"), {});
    const { response } = await dispatch(sw.listeners.get("fetch"), {
      request: nav("/positions"),
    });
    expect(response!.status).toBe(500);
    expect(await response!.text()).toBe("boom");
  });

  it("los archivos de la pantalla sin conexión salen del caché aunque no haya red", async () => {
    const sw = loadServiceWorker({ network: offline });
    await dispatch(sw.listeners.get("install"), {});
    for (const path of [
      "/pwa/offline.css",
      "/pwa/offline.js",
      "/icons/icon-192.png",
    ]) {
      const { response } = await dispatch(sw.listeners.get("fetch"), {
        request: {
          method: "GET",
          url: `https://app.example${path}`,
          mode: "no-cors",
        },
      });
      expect(await response!.text(), path).toBe(`caché:${path}`);
    }
  });

  it("no toca nada más: POST (acciones del servidor), otros orígenes, datos y recursos de Next", async () => {
    const sw = loadServiceWorker({ network: offline });
    await dispatch(sw.listeners.get("install"), {});
    const untouched: Array<FakeEvent["request"]> = [
      { method: "POST", url: "https://app.example/watchlist", mode: "cors" },
      { method: "PUT", url: "https://app.example/", mode: "cors" },
      // Un formulario sin JavaScript que navega con POST (mode "navigate") tampoco se intercepta.
      { method: "POST", url: "https://app.example/login", mode: "navigate" },
      { method: "GET", url: "https://otro.example/x", mode: "navigate" },
      {
        method: "GET",
        url: "https://app.example/_next/static/chunks/a.js",
        mode: "no-cors",
      },
      {
        method: "GET",
        url: "https://app.example/positions?_rsc=abc",
        mode: "cors",
      },
      {
        method: "GET",
        url: "https://app.example/api/cron/daily-prices",
        mode: "cors",
      },
      {
        method: "GET",
        url: "https://app.example/activity/export",
        mode: "cors",
      },
    ];
    for (const request of untouched) {
      const { handled } = await dispatch(sw.listeners.get("fetch"), {
        request,
      });
      expect(handled, `${request!.method} ${request!.url}`).toBe(false);
    }
  });

  it("jamás guarda páginas ni datos: solo se llena el caché al instalar", async () => {
    const sw = loadServiceWorker({ network: online });
    await dispatch(sw.listeners.get("install"), {});
    for (const path of ["/", "/positions", "/watchlist", "/activity"]) {
      await dispatch(sw.listeners.get("fetch"), { request: nav(path) });
    }
    const cache = sw.open(CACHE);
    expect(cache.puts).toBe(0);
    expect(
      [...cache.entries.keys()].every(
        (k) => k.startsWith("/pwa/") || k.startsWith("/icons/"),
      ),
    ).toBe(true);
  });
});

describe("pantalla sin conexión (public/pwa)", () => {
  const html = readFileSync(publicFile("/pwa/offline.html"), "utf8");

  it("sus archivos existen y no depende de nada externo ni de código en línea", () => {
    for (const ref of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      expect(ref[1]!.startsWith("/"), ref[1]).toBe(true);
      expect(existsSync(publicFile(ref[1]!)), ref[1]).toBe(true);
    }
    expect(html).not.toMatch(/<script>|<style>|onclick=/i);
    expect(html).toContain("Sin conexión");
    expect(html).toContain('lang="es"');
  });
});
