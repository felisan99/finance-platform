import { spawn, type ChildProcess } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAdmin,
  assertDevProject,
  deleteTestUser,
  randomSymbol,
  type DbClient,
} from "@/lib/db/__tests__/integration-helpers";
import type { Database, Json } from "@/lib/db/database.types";
import { validateLedgerChange } from "@/lib/engine";
import { ensureInstruments } from "@/lib/market-jobs/instruments";
import { buildImportTemplate } from "@/lib/importers";
import { prepareImport } from "../import-flow";
import {
  inputToInsertRow,
  inputToTransaction,
  draftsToRpcRows,
  rowToTransaction,
} from "../mappers";
import {
  getInstruments,
  getPrimaryAccount,
  getTransactionIdsByImport,
  getTransactionRows,
} from "../queries";
import { parseTransactionForm } from "@/lib/validation/transaction";
import { FIXTURE_CSV } from "./fixture";

// Criterio de terminado de la Fase 4 (spec §14.2): "importar el CSV de Delta y ver los números de
// la sección 8.3 en pantalla", verificado por HTTP con una sesión real, sin navegador.
//
// Prueba EN VIVO (`pnpm test:live`, no corre en el CI). Necesita el build de producción hecho
// (`pnpm build`): levanta `next start` en un puerto propio. Crea usuarios de prueba en finance-dev
// (con contraseña, solo para esta prueba), los sesiona con las mismas cookies que usa la app,
// importa el CSV del fixture con las funciones que usa la interfaz y pide cada pantalla. Al terminar
// borra los usuarios y el instrumento DDOG si lo crea; los 10 instrumentos del fixture ya existen y
// no se tocan.

const PORT = 3113;
const BASE = `http://localhost:${PORT}`;

/** Cookies de la sesión, con el mismo formato que las guarda `@supabase/ssr` en el navegador. */
class CookieJar {
  private readonly cookies = new Map<string, string>();
  getAll() {
    return [...this.cookies].map(([name, value]) => ({ name, value }));
  }
  setAll(list: Array<{ name: string; value: string }>) {
    for (const { name, value } of list) {
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

interface Session {
  userId: string;
  email: string;
  jar: CookieJar;
  client: ReturnType<typeof createServerClient<Database>>;
}

/** El mensaje de la pantalla "no encontrado". El código HTTP puede ser 200: `loading.tsx` empieza a transmitir antes de resolver los datos. */
const NOT_FOUND = "No encontramos esa página";

/** HTML legible: sin los comentarios de React entre nodos de texto ni espacios de no separación. */
const text = (html: string) =>
  html.replace(/<!-- -->/g, "").replace(/[  ]/g, " ");

describe("la app por HTTP con sesión real (aceptación de la Fase 4)", () => {
  let admin: DbClient;
  let server: ChildProcess | undefined;
  let a: Session;
  let b: Session;
  let ddogCreated = false;
  let watchedInstrumentId: string | undefined;
  const liveInstrumentIds: string[] = [];
  const userIds: string[] = [];

  async function newSession(label: string): Promise<Session> {
    const { url, publishableKey } = assertDevProject();
    const email = `rls-http-${label}-${Math.random().toString(16).slice(2, 10)}@example.com`;
    const password = `p${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(`No se pudo crear el usuario: ${error?.message}`);
    userIds.push(data.user.id);

    const jar = new CookieJar();
    const client = createServerClient<Database>(url, publishableKey, {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list) => jar.setAll(list),
      },
    });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error)
      throw new Error(`No se pudo iniciar sesión: ${signIn.error.message}`);
    return { userId: data.user.id, email, jar, client };
  }

  const get = (path: string, session?: Session, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, {
      redirect: "manual",
      ...init,
      headers: {
        ...(session ? { cookie: session.jar.header() } : {}),
        ...init.headers,
      },
    });

  const page = async (path: string, session: Session) => {
    const response = await get(path, session);
    return {
      status: response.status,
      html: text(await response.text()),
      response,
    };
  };

  beforeAll(async () => {
    admin = createAdmin();
    a = await newSession("a");
    b = await newSession("b");

    server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
      cwd: process.cwd(),
      stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production" },
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/login`, { redirect: "manual" })).status < 500)
          return;
      } catch {
        /* todavía no levantó */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("`next start` no levantó: ¿corriste `pnpm build`?");
  }, 120_000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    for (const id of userIds) await deleteTestUser(admin, { id, email: id });
    if (ddogCreated)
      await admin.from("instruments").delete().eq("symbol", "DDOG");
    // Después de los usuarios: sus filas de watchlist apuntan al instrumento (sus cierres se van en cascada).
    if (watchedInstrumentId)
      await admin.from("instruments").delete().eq("id", watchedInstrumentId);
    for (const id of liveInstrumentIds)
      await admin.from("instruments").delete().eq("id", id);
  });

  it("sin sesión, todas las pantallas mandan a /login", async () => {
    for (const path of [
      "/",
      "/positions",
      "/positions/VOO",
      "/activity",
      "/activity/new",
      "/activity/import",
      "/more",
      "/watchlist",
      "/activity/export",
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location"), path).toMatch(/\/login$/);
    }
  });

  it("la app instalable: manifiesto, service worker y pantalla sin conexión son públicos, con las cabeceras de seguridad", async () => {
    const manifest = await get("/manifest.webmanifest");
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain("manifest+json");
    const parsed = (await manifest.json()) as {
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    expect(parsed).toMatchObject({ display: "standalone", start_url: "/" });
    expect(parsed.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    expect(parsed.icons.some((icon) => icon.purpose === "maskable")).toBe(true);

    // Cada ícono del manifiesto se sirve sin sesión, como imagen.
    for (const icon of parsed.icons) {
      const response = await get(icon.src);
      expect(response.status, icon.src).toBe(200);
      expect(response.headers.get("content-type"), icon.src).toBe("image/png");
    }

    const sw = await get("/sw.js");
    expect(sw.status).toBe(200);
    expect(sw.headers.get("content-type")).toContain("javascript");
    expect(sw.headers.get("cache-control")).toContain("no-store");
    expect(sw.headers.get("service-worker-allowed")).toBe("/");
    expect(sw.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );

    for (const path of [
      "/pwa/offline.html",
      "/pwa/offline.css",
      "/pwa/offline.js",
    ]) {
      expect((await get(path)).status, path).toBe(200);
    }
    const offline = text(await (await get("/pwa/offline.html")).text());
    expect(offline).toContain("Sin conexión");
    // La pantalla sin conexión no lleva datos de nadie: solo la estructura.
    expect(offline).not.toMatch(/US\$|VOO|Valor total \d/);

    // Cabeceras de seguridad en una pantalla pública y en una privada (con sesión).
    for (const response of [await get("/login"), await get("/", a)]) {
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(response.headers.get("strict-transport-security")).toContain(
        "max-age=",
      );
      expect(response.headers.get("permissions-policy")).toContain("camera=()");
      expect(response.headers.get("x-powered-by")).toBeNull();
    }
  });

  it("el ingreso es por código: no hay enlace de retorno y la pantalla lo dice", async () => {
    const login = text(await (await get("/login")).text());
    expect(login).toContain("código de 6 dígitos");
    expect(login).toContain("Enviar código");
    expect(login).toContain("Ya tengo un código");
    expect(login.toLowerCase()).not.toContain("enlace de acceso");
    // El retorno del enlace mágico ya no existe: sin sesión manda a /login, con sesión da "no encontrado".
    const anon = await get("/auth/callback?code=abc");
    expect(anon.status).toBe(307);
    expect(anon.headers.get("location")).toMatch(/\/login$/);
    const withSession = await page("/auth/callback?code=abc", a);
    expect(withSession.html).toContain(NOT_FOUND);
    // Con sesión, /login lleva al inicio.
    const loggedIn = await get("/login", a);
    expect(loggedIn.status).toBe(307);
    expect(loggedIn.headers.get("location")).toMatch(/\/$/);
  });

  it("una cuenta nueva ve los estados vacíos, con los caminos para empezar", async () => {
    const home = await page("/", a);
    expect(home.status).toBe(200);
    expect(home.html).toContain("Todavía no cargaste operaciones");
    expect(home.html).toContain("Importar un CSV");
    expect((await page("/positions", a)).html).toContain(
      "Todavía no cargaste operaciones",
    );
    expect((await page("/activity", a)).html).toContain(
      "Todavía no hay operaciones",
    );
    const more = await page("/more", a);
    expect(more.html).toContain(a.email);
    expect(more.html).toContain("Cerrar sesión");
  });

  it("importa el CSV del fixture con las mismas funciones que la interfaz: vista previa, alta de instrumentos y RPC atómico", async () => {
    const prepared = await prepareImport(a.client, FIXTURE_CSV, new Date());
    expect(prepared).not.toBeNull();
    const { view, toInsert, newInstruments } = prepared!.preview;
    expect(view.canConfirm).toBe(true);
    expect(view.after).toMatchObject({
      cash: "882.745",
      openCostBasis: "8664.27",
      realizedPnl: "247.015",
    });

    // Los 10 símbolos del fixture ya existen en finance-dev (los dejó el cron): no se vuelven a crear.
    const ids = await ensureInstruments(admin, newInstruments);
    expect(ids.size).toBe(newInstruments.length);

    const { data, error } = await a.client.rpc("import_transactions", {
      p_account_id: prepared!.account.id,
      p_source: "delta_csv",
      p_filename: "delta_export.csv",
      p_rows: draftsToRpcRows(toInsert) as unknown as Json,
      p_report: { fileRows: view.fileRows } as unknown as Json,
    });
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      inserted: toInsert.length,
      duplicates: 0,
    });

    // Reimportar el mismo archivo: no queda nada nuevo (dedupe por external_id).
    const again = await prepareImport(a.client, FIXTURE_CSV, new Date());
    expect(again!.preview.view.newCount).toBe(0);
    expect(again!.preview.view.duplicateCount).toBe(toInsert.length);
    expect(again!.preview.view.canConfirm).toBe(false);
  }, 120_000);

  it("Posiciones muestra los números de la sección 8.3", async () => {
    const { status, html } = await page("/positions", a);
    expect(status).toBe(200);
    // Totales, con el valor exacto (sin redondear a centavos) para contrastar con el spec.
    expect(html).toContain("Exacto: 8.664,27"); // costo base de las abiertas
    expect(html).toContain("Exacto: 247,015"); // realizado de las cerradas
    expect(html).toContain("Exacto: 882,745"); // efectivo
    // Las cinco abiertas, con su cantidad y costo base.
    for (const [symbol, quantity, cost] of [
      ["VOO", "8,95", "US$ 5.724,77"],
      ["SOXX", "3", "US$ 2.069,50"],
      ["FSLY", "20", "US$ 346,80"],
      ["ILF", "10", "US$ 331,60"],
      ["NFLX", "3", "US$ 191,60"],
    ] as const) {
      expect(html, symbol).toContain(symbol);
      expect(html, `${symbol} costo`).toContain(`(costo ${cost})`);
      expect(html, `${symbol} cantidad`).toContain(`${quantity} ×`);
    }
    expect(html).toContain("5 abiertas · 5 cerradas");
    expect(html).toContain("Mostrar posiciones cerradas (5)");
  });

  it("las posiciones cerradas muestran la ganancia realizada de cada una", async () => {
    const { html } = await page("/positions?cerradas=1", a);
    for (const [symbol, realized] of [
      ["MELI", "+US$ 180,55"],
      ["URTH", "+US$ 42,70"],
      ["KOS", "+US$ 11,14"],
      ["QCOM", "+US$ 7,52"],
      ["TTWO", "+US$ 5,11"],
    ] as const) {
      expect(html, symbol).toContain(symbol);
      expect(html, `${symbol} realizado`).toContain(realized);
    }
    expect(html).toContain("Ocultar posiciones cerradas");
  });

  it("los órdenes de la lista son válidos y un orden inventado no rompe", async () => {
    for (const orden of [
      "value",
      "dayPct",
      "pnl",
      "pnlPct",
      "symbol",
      "__proto__",
      "nope",
      "",
    ]) {
      expect((await page(`/positions?orden=${orden}`, a)).status, orden).toBe(
        200,
      );
    }
  });

  it("Inicio muestra el efectivo y los totales", async () => {
    const { status, html } = await page("/", a);
    expect(status).toBe(200);
    expect(html).toContain("Valor total");
    expect(html).toContain("Efectivo");
    expect(html).toContain("Exacto: 882,745");
    expect(html).toContain(`Dividendos ${new Date().getFullYear()}`);
    expect(html).toContain("Ganancia realizada");
    expect(html).toContain("+US$ 247,02"); // 247.015 redondeado a centavos
    // La composición del portafolio: una porción por posición abierta y el efectivo aparte.
    // El rendimiento (Fase 5): la tarjeta con sus datos del período elegido (Todo) y el benchmark.
    expect(html).toContain("Rendimiento");
    expect(html).toContain("Rendimiento (TWR)");
    expect(html).toContain("XIRR (anual)");
    expect(html).toContain("S&amp;P 500");
    expect(html).toContain("Composición");
    expect(html).toContain("Agrupar por");
    for (const symbol of ["VOO", "SOXX", "FSLY", "ILF", "NFLX"]) {
      expect(html).toContain(symbol);
    }
  });

  it("Inicio v2: ganancia total, ganancia por posición, tendencias, rendimiento por mes y riesgo", async () => {
    const { status, html } = await page("/", a);
    expect(status).toBe(200);
    // Hero: lo aportado son los depósitos del fixture (spec §8.3: 9300 sin retiros).
    expect(html).toContain("Ganancia total");
    expect(html).toContain("Aportado neto");
    expect(html).toContain("US$ 9.300,00");
    expect(html).toContain("sobre lo aportado");
    // Gráfico principal: el modo Ganancia (por defecto) y su ganancia del período.
    expect(html).toContain("Ganancia del período");
    // Ganancia por posición: las cerradas traen su realizado exacto (spec §8.3).
    expect(html).toContain("Ganancia por posición");
    expect(html).toContain("+US$ 180,55"); // MELI
    expect(html).toContain("+US$ 42,70"); // URTH
    expect(html).toContain("cerrada");
    expect(html).toContain("Tus posiciones");
    expect(html).toContain("Rendimiento por mes");
    expect(html).toContain("Riesgo");
    expect(html).toContain("Caída máxima");
    // Reemplazadas por las barras de ganancia por posición.
    expect(html).not.toContain("Mejores del día");
    expect(html).not.toContain("Peores del día");
  });

  it("el detalle de una posición: cantidad, costo exacto, operaciones y gráfico", async () => {
    const { status, html } = await page("/positions/VOO", a);
    expect(status).toBe(200);
    expect(html).toContain("VOO");
    expect(html).toContain("Exacto: 5.724,77");
    expect(html).toContain("Operaciones (8)");
    expect(html).toContain("Precio de cierre");
    // Tolera minúsculas y punto en la URL, como el alta manual.
    expect((await page("/positions/voo", a)).status).toBe(200);
    // Una posición cerrada también tiene detalle.
    const meli = await page("/positions/MELI", a);
    expect(meli.status).toBe(200);
    expect(meli.html).toContain("Posición cerrada");
  });

  it("Actividad lista las operaciones, filtra y pagina", async () => {
    const all = await page("/activity", a);
    expect(all.status).toBe(200);
    const links = (html: string) =>
      html.match(/href="\/activity\/[0-9a-f-]{36}"/g)?.length ?? 0;
    const rows = await getTransactionRows(
      a.client,
      (await getPrimaryAccount(a.client))!.id,
    );
    expect(links(all.html)).toBe(Math.min(rows.length, 50));
    expect(all.html).toContain("Exportar CSV");

    const sells = rows.filter((r) => r.type === "SELL").length;
    expect(links((await page("/activity?tipo=SELL", a)).html)).toBe(sells);
    // VOO tiene 8 operaciones en el CSV (todas compras).
    expect(links((await page("/activity?simbolo=voo", a)).html)).toBe(8);
    expect((await page("/activity?simbolo=ZZZZ", a)).html).toContain(
      "No hay operaciones con esos filtros",
    );

    // Filtros y páginas inválidos se ignoran (no son un 500).
    for (const query of [
      "?tipo=__proto__&pagina=-1",
      "?desde=ayer&hasta=2026-02-31",
      "?pagina=abc",
      "?pagina=9999",
      "?simbolo=%27%3B%20drop",
    ]) {
      expect((await page(`/activity${query}`, a)).status, query).toBe(200);
    }
  });

  it("la exportación devuelve todas las operaciones en CSV, con BOM y como descarga", async () => {
    const response = await get("/activity/export", a);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="transacciones-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // `fetch().text()` descarta la BOM al decodificar: se comprueban los bytes (EF BB BF).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes);
    expect(csv.startsWith("fecha_utc,")).toBe(true);
    const rows = await getTransactionRows(
      a.client,
      (await getPrimaryAccount(a.client))!.id,
    );
    expect(csv.trimEnd().split("\r\n")).toHaveLength(rows.length + 1);
  });

  it("alta manual de la sección 8.3: BUY DDOG 2 @ 251,41 con comisión 1,00 → costo 503.82 y efectivo 378.925", async () => {
    // El instrumento DDOG lo crea el servidor con la clave secreta (acá, saltando la verificación de Yahoo).
    // Solo se borra al final si lo creó esta prueba: en finance-dev el DDOG puede ser uno real (cargado
    // desde la app), con su historial de precios.
    const ddogExisted =
      ((await admin.from("instruments").select("id").eq("symbol", "DDOG")).data
        ?.length ?? 0) > 0;
    await ensureInstruments(admin, [
      { symbol: "DDOG", name: "Datadog, Inc.", type: "STOCK" },
    ]);
    ddogCreated = !ddogExisted;

    const parsed = parseTransactionForm(
      {
        type: "BUY",
        symbol: "ddog",
        quantity: "2",
        price: "251,41",
        fee: "1,00",
        executedAt: "2026-09-23T12:00",
      },
      new Date(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const account = (await getPrimaryAccount(a.client))!;
    const rows = await getTransactionRows(a.client, account.id);
    const instruments = await getInstruments(a.client, [
      ...new Set(
        rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : [])),
      ),
    ]);
    const existing = rows.map((r) =>
      rowToTransaction(
        r,
        account.id,
        new Map(instruments.map((i) => [i.id, i.symbol])),
      ),
    );
    const check = validateLedgerChange(existing, {
      kind: "add",
      tx: inputToTransaction(parsed.data, {
        id: "nueva",
        accountId: account.id,
        createdAt: new Date(),
      }),
    });
    expect(check.ok).toBe(true);

    const ddog = (
      await admin.from("instruments").select("id").eq("symbol", "DDOG").single()
    ).data;
    const { error } = await a.client.from("transactions").insert(
      inputToInsertRow(parsed.data, {
        userId: a.userId,
        accountId: account.id,
        instrumentId: ddog!.id,
      }),
    );
    expect(error).toBeNull();

    const { html } = await page("/positions", a);
    expect(html).toContain("DDOG");
    expect(html).toContain("(costo US$ 503,82)");
    expect(html).toContain("Exacto: 378,925"); // efectivo tras la compra
    expect(html).toContain("6 abiertas · 5 cerradas");
    expect(html).toContain("Exacto: 9.168,09"); // 8664.27 + 503.82

    const detail = await page("/positions/DDOG", a);
    expect(detail.html).toContain("Exacto: 503,82");
  }, 60_000);

  it("editar una operación: la pantalla carga los valores actuales", async () => {
    const account = (await getPrimaryAccount(a.client))!;
    const { data } = await a.client
      .from("transactions")
      .select("id")
      .eq("account_id", account.id)
      .eq("source", "manual")
      .limit(1);
    const id = data![0]!.id;
    const { status, html } = await page(`/activity/${id}`, a);
    expect(status).toBe(200);
    expect(html).toContain("Editar operación");
    expect(html).toContain('value="251.41"');
    expect(html).toContain('value="2026-09-23T12:00"');
    expect(html).toContain("Eliminar operación");
    // El origen manual no muestra la advertencia de reimportación hasta confirmar; el formulario existe.
    expect(html).toContain("Guardar cambios");
  });

  it("las pantallas de alta e importación cargan", async () => {
    const created = await page("/activity/new", a);
    expect(created.status).toBe(200);
    expect(created.html).toContain("Nueva operación");
    expect(created.html).toContain('type="datetime-local"');
    expect(created.html).toContain("Guardar operación");
    const imported = await page("/activity/import", a);
    expect(imported.status).toBe(200);
    expect(imported.html).toContain("Cómo cargar tus operaciones");
    expect(imported.html).toContain("Descargar la plantilla");
    expect(imported.html).toContain("Pegar filas");
    expect(imported.html).toContain("Archivo CSV");
    expect(imported.html).toContain("Ver vista previa");
    // La importación de Delta quedó en el historial, con su botón para deshacerla.
    expect(text(imported.html)).toContain("delta_export.csv");
    expect(text(imported.html)).toContain("Formato Delta");
    expect(imported.html).toContain("Deshacer importación");
  });

  it("importar en el formato simple: plantilla, vista previa, parecidas, ida y vuelta con la exportación y deshacer", async () => {
    // La plantilla: solo con sesión, y es la misma que arma el código.
    const anonymous = await get("/activity/import/plantilla");
    expect(anonymous.status).toBe(307);
    expect(anonymous.headers.get("location")).toContain("/login");
    const template = await get("/activity/import/plantilla", b);
    expect(template.status).toBe(200);
    expect(template.headers.get("content-disposition")).toContain(
      "plantilla-portfolio-tracker.csv",
    );
    expect(template.headers.get("cache-control")).toContain("no-store");
    // `Response.text()` descarta la BOM del principio.
    expect(await template.text()).toBe(buildImportTemplate().slice(1));

    const account = (await getPrimaryAccount(b.client))!;
    const now = new Date();
    const csv = [
      "fecha;tipo;simbolo;cantidad;precio;monto;comision;notas",
      "06/03/2026;depósito;;;;5000;;",
      "09/03/2026;compra;VOO;3;575,24;;1;",
      "15/04/2026;venta;VOO;1;640,5;;1;",
    ].join("\n");

    // Vista previa: formato reconocido, coma decimal y fechas día/mes/año bien leídas.
    const prepared = (await prepareImport(b.client, csv, now))!;
    expect(prepared.format).toBe("simple");
    expect(prepared.source).toBe("csv");
    const { view } = prepared.preview;
    expect(view.format?.label).toBe("Portfolio Tracker");
    expect(view.canConfirm).toBe(true);
    expect(view.newCount).toBe(3);
    expect(view.rows.map((r) => [r.date, r.typeLabel, r.symbol])).toEqual([
      ["06/03/2026", "Depósito", ""],
      ["09/03/2026", "Compra", "VOO"],
      ["15/04/2026", "Venta", "VOO"],
    ]);
    // 5000 − (3 × 575,24 + 1) + (640,5 − 1) = 3912,78
    expect(view.after?.cash).toBe("3912.78");
    expect(view.after?.openPositions).toMatchObject([
      { symbol: "VOO", quantity: "2" },
    ]);

    // Un símbolo mal escrito se marca (esto sí sale a Yahoo) y no se puede confirmar.
    const typo = (await prepareImport(
      b.client,
      csv.replace("VOO", "APPL"),
      now,
    ))!;
    expect(typo.preview.view.canConfirm).toBe(false);
    expect(typo.preview.view.errorGroups[0]).toMatchObject({
      code: "INVALID_SYMBOL",
    });

    // Confirmar, con las mismas funciones que la interfaz.
    await ensureInstruments(admin, prepared.preview.newInstruments);
    const { data, error } = await b.client.rpc("import_transactions", {
      p_account_id: account.id,
      p_source: prepared.source!,
      p_filename: "simple.csv",
      p_rows: draftsToRpcRows(prepared.preview.toInsert) as unknown as Json,
      p_report: { fileRows: view.fileRows } as unknown as Json,
    });
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({ inserted: 3, duplicates: 0 });
    const importId = data![0]!.import_id;
    expect((await page("/positions", b)).html).toContain("VOO");
    const history = await page("/activity/import", b);
    expect(text(history.html)).toContain("Formato Portfolio Tracker");
    expect(history.html).toContain("Deshacer importación");

    // Lo mismo otra vez: todo ya importado.
    const again = (await prepareImport(b.client, csv, now))!;
    expect(again.preview.view.newCount).toBe(0);
    expect(again.preview.view.duplicateCount).toBe(3);
    expect(again.preview.view.canConfirm).toBe(false);

    // Una compra que solo difiere en el precio parece repetir una ya cargada: se excluye por defecto.
    const similarCsv =
      "fecha;tipo;simbolo;cantidad;precio\n09/03/2026;compra;VOO;3;613,00";
    const similar = (await prepareImport(b.client, similarCsv, now))!;
    expect(similar.preview.view.suspectedCount).toBe(1);
    expect(similar.preview.view.newCount).toBe(0);
    const included = (await prepareImport(b.client, similarCsv, now, {
      includeSuspected: true,
    }))!;
    expect(included.preview.view.newCount).toBe(1);

    // Ida y vuelta: lo que baja «Exportar CSV» se vuelve a leer y todo figura como ya importado.
    const exported = await (await get("/activity/export", b)).text();
    const roundTrip = (await prepareImport(b.client, exported, now))!;
    expect(roundTrip.format).toBe("simple");
    expect(roundTrip.preview.view.errorCount).toBe(0);
    expect(roundTrip.preview.view.duplicateCount).toBe(3);
    expect(roundTrip.preview.view.newCount).toBe(0);

    // Deshacer: primero se comprueba que el libro siga consistente, y después se borra.
    const ids = await getTransactionIdsByImport(b.client, importId);
    expect(ids).toHaveLength(3);
    const undone = await b.client.rpc("undo_import", { p_import_id: importId });
    expect(undone.error).toBeNull();
    expect(undone.data).toBe(3);
    expect(await getTransactionIdsByImport(b.client, importId)).toEqual([]);
    expect(text((await page("/activity/import", b)).html)).toContain(
      "deshecha el",
    );
    expect((await page("/positions", b)).html).toContain(
      "Todavía no cargaste operaciones",
    );
  }, 120_000);

  it("direcciones inválidas: 'No encontramos esa página' o 400, nunca un error del servidor", async () => {
    for (const path of [
      "/positions/NOPE",
      "/positions/A%20B%20C",
      "/activity/no-es-un-uuid",
      "/activity/00000000-0000-0000-0000-000000000000",
    ]) {
      const { status, html } = await page(path, a);
      expect([200, 404], path).toContain(status); // nunca 500
      expect(html, path).toContain(NOT_FOUND);
    }
    // Una dirección que no existe en ninguna parte también.
    const missing = await page("/no-existe", a);
    expect(missing.status).toBe(404);
    expect(missing.html).toContain(NOT_FOUND);
    // Codificación de URL mal formada: el proxy responde 400 antes de que falle el enrutador de Next.
    for (const path of [
      "/positions/%E0%A4%A",
      "/positions/%zz",
      "/activity/%zz",
      "/%",
    ]) {
      expect((await page(path, a)).status, path).toBe(400);
      expect((await get(path)).status, `${path} sin sesión`).toBe(400);
    }
  });

  it("Watchlist (Fase 6): vacía, con un símbolo seguido sin posición, su detalle y el aislamiento entre usuarios", async () => {
    // Un instrumento de prueba con cierres conocidos, dentro de las últimas 52 semanas.
    const today = new Date();
    const daysAgo = (n: number) =>
      new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
    const symbol = randomSymbol();
    const { data: instrument, error } = await admin
      .from("instruments")
      .insert({ symbol, name: "Watchlist de prueba", type: "ETF" })
      .select("id")
      .single();
    if (error || !instrument)
      throw new Error(`instrumento de prueba: ${error?.message}`);
    watchedInstrumentId = instrument.id;
    const closes: Array<[number, number]> = [
      [40, 90],
      [30, 130],
      [20, 100],
      [2, 110],
      [1, 112.5],
    ];
    const inserted = await admin.from("prices_daily").insert(
      closes.map(([days, close]) => ({
        instrument_id: instrument.id,
        date: daysAgo(days),
        close,
      })),
    );
    expect(inserted.error).toBeNull();

    // Vacía: el estado inicial y la pestaña en la navegación.
    const empty = await page("/watchlist", b);
    expect(empty.status).toBe(200);
    expect(empty.html).toContain("Todavía no seguís ningún símbolo");
    expect(empty.html).toContain("0 de 50 símbolos");
    expect(empty.html).toContain('href="/watchlist"');

    // La persona sigue el símbolo (lo mismo que hace la acción, con su propia sesión y RLS).
    const { data: list } = await b.client
      .from("watchlists")
      .select("id")
      .limit(1)
      .single();
    const follow = await b.client.from("watchlist_items").insert({
      watchlist_id: list!.id,
      instrument_id: instrument.id,
      user_id: b.userId,
    });
    expect(follow.error).toBeNull();

    const followed = await page("/watchlist", b);
    expect(followed.status).toBe(200);
    expect(followed.html).toContain("1 de 50 símbolos");
    expect(followed.html).toContain(symbol);
    expect(followed.html).toContain("Watchlist de prueba");
    expect(followed.html).toContain("112,50"); // último cierre
    expect(followed.html).toContain("+US$ 2,50"); // 112,5 − 110
    expect(followed.html).toContain("+2,27%"); // 2,5 / 110
    expect(followed.html).toContain("90,00"); // mínimo de 52 semanas
    expect(followed.html).toContain("130,00"); // máximo
    expect(followed.html).toContain(`Quitar ${symbol} de la watchlist`);
    expect(followed.html).not.toContain("Sin precio todavía");

    // El detalle de un símbolo que se sigue pero no se tiene.
    const detail = await page(`/positions/${symbol}`, b);
    expect(detail.status).toBe(200);
    expect(detail.html).toContain("Rango de 52 semanas");
    expect(detail.html).toContain("Dejar de seguir");
    expect(detail.html).toContain("no tenés una posición");
    expect(detail.html).not.toContain("Costo promedio");
    expect(detail.html).not.toContain("Operaciones (");

    // Otra persona no lo ve en su lista ni puede abrir su detalle (RLS): para ella no existe.
    expect((await page("/watchlist", a)).html).not.toContain(symbol);
    const foreign = await page(`/positions/${symbol}`, a);
    expect(foreign.html).toContain(NOT_FOUND);
    expect(foreign.html).not.toContain("Rango de 52 semanas");

    // Al dejar de seguir, el detalle vuelve a no existir.
    const unfollow = await b.client
      .from("watchlist_items")
      .delete()
      .eq("instrument_id", instrument.id);
    expect(unfollow.error).toBeNull();
    expect((await page(`/positions/${symbol}`, b)).html).toContain(NOT_FOUND);
    expect((await page("/watchlist", b)).html).toContain(
      "Todavía no seguís ningún símbolo",
    );
  });

  it("«Actualizar precios»: con la cotización de hoy el gráfico llega al mismo valor que Inicio, y sin la del benchmark queda en el cierre", async () => {
    const c = await newSession("live");
    const held = randomSymbol();
    const bench = randomSymbol();
    const created = async (symbol: string, type: string) => {
      const { data, error } = await admin
        .from("instruments")
        .insert({ symbol, name: `En vivo ${symbol}`, type })
        .select("id")
        .single();
      if (error || !data) throw new Error(`instrumento: ${error?.message}`);
      liveInstrumentIds.push(data.id);
      return data.id;
    };
    const heldId = await created(held, "STOCK");
    const benchId = await created(bench, "ETF");

    // Cierres del lunes 2 al jueves 5 de marzo de 2026 y la cotización del viernes 6 a media rueda.
    const days = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"];
    const bars = (id: string, closes: number[]) =>
      closes.map((close, i) => ({
        instrument_id: id,
        date: days[i]!,
        close,
        adj_close: close,
      }));
    expect(
      (
        await admin
          .from("prices_daily")
          .insert([
            ...bars(heldId, [100, 102, 104, 103]),
            ...bars(benchId, [500, 505, 510, 508]),
          ])
      ).error,
    ).toBeNull();
    const asOf = "2026-03-06T15:00:00Z"; // 12:00 en Montevideo
    const quoteOf = (id: string, price: number) => ({
      instrument_id: id,
      price,
      change: 1,
      as_of: asOf,
    });
    expect(
      (
        await admin
          .from("quotes_latest")
          .insert([quoteOf(heldId, 110), quoteOf(benchId, 520)])
      ).error,
    ).toBeNull();

    // Su benchmark es el instrumento de prueba; depósito de 2000 y 10 acciones a 100.
    expect(
      (
        await admin
          .from("portfolios")
          .update({ benchmark_symbol: bench })
          .eq("user_id", c.userId)
      ).error,
    ).toBeNull();
    const account = (await getPrimaryAccount(c.client))!;
    const base = { user_id: c.userId, account_id: account.id, currency: "USD" };
    expect(
      (
        await admin.from("transactions").insert([
          {
            ...base,
            type: "DEPOSIT" as const,
            amount: 2000,
            executed_at: "2026-03-02T15:00:00Z",
          },
          {
            ...base,
            type: "BUY" as const,
            instrument_id: heldId,
            quantity: 10,
            price: 100,
            executed_at: "2026-03-02T15:00:00Z",
          },
        ])
      ).error,
    ).toBeNull();

    const count = (html: string, needle: string) =>
      html.split(needle).length - 1;

    // Con las dos cotizaciones de hoy: 10 × 110 + 1000 de efectivo = 2100, ganancia 100 en Inicio y
    // en la tarjeta de rendimiento (dos veces: arriba y en «Ganancia del período»).
    const live = await page("/", c);
    expect(live.status).toBe(200);
    expect(live.html).toContain("2.100,00");
    expect(count(live.html, "+US$ 100,00")).toBeGreaterThanOrEqual(2);
    expect(live.html).toContain(
      "cierres al 05/03/2026 y cotización del 06/03/2026 12:00",
    );
    expect(live.html).toContain("Incluye la cotización de hoy");

    // El gráfico de precio de la posición también termina en la cotización.
    expect((await page(`/positions/${held}`, c)).html).toContain("110,00");

    // Sin la cotización de hoy del benchmark el gráfico no mezcla días: queda en el último cierre
    // (2030 → +30), y el valor de Inicio sigue con la cotización.
    expect(
      (await admin.from("quotes_latest").delete().eq("instrument_id", benchId))
        .error,
    ).toBeNull();
    const closed = await page("/", c);
    expect(closed.status).toBe(200);
    expect(closed.html).toContain("2.100,00");
    expect(closed.html).toContain("+US$ 30,00");
    expect(closed.html).toContain("cierres al 05/03/2026");
    expect(closed.html).not.toContain("y cotización del");
    expect(closed.html).not.toContain("Incluye la cotización de hoy");

    // Con el cierre del día ya guardado, la cotización deja de ser más nueva y el punto en vivo
    // desaparece solo: el cierre gana.
    expect(
      (
        await admin.from("prices_daily").insert([
          { instrument_id: heldId, date: "2026-03-06", close: 110 },
          {
            instrument_id: benchId,
            date: "2026-03-06",
            close: 520,
            adj_close: 520,
          },
        ])
      ).error,
    ).toBeNull();
    expect(
      (await admin.from("quotes_latest").insert(quoteOf(benchId, 520))).error,
    ).toBeNull();
    const settled = await page("/", c);
    expect(settled.html).toContain("cierres al 06/03/2026");
    expect(settled.html).not.toContain("y cotización del");
    expect(count(settled.html, "+US$ 100,00")).toBeGreaterThanOrEqual(2);
  });

  it("una posición propia ofrece Seguir, y seguirla no cambia sus números", async () => {
    const before = await page("/positions/VOO", a);
    expect(before.status).toBe(200);
    expect(before.html).toContain("Seguir");
    expect(before.html).not.toContain("Dejar de seguir");

    const account = (await getPrimaryAccount(a.client))!;
    expect(account).toBeTruthy();
    const { data: voo } = await admin
      .from("instruments")
      .select("id")
      .eq("symbol", "VOO")
      .single();
    const { data: list } = await a.client
      .from("watchlists")
      .select("id")
      .limit(1)
      .single();
    const follow = await a.client.from("watchlist_items").insert({
      watchlist_id: list!.id,
      instrument_id: voo!.id,
      user_id: a.userId,
    });
    expect(follow.error).toBeNull();

    const after = await page("/positions/VOO", a);
    expect(after.html).toContain("Dejar de seguir");
    expect(after.html).toContain("Operaciones ("); // sigue siendo el detalle de la posición
    expect(after.html).toContain("5.724,77"); // costo base: no cambió
    const watchlist = await page("/watchlist", a);
    expect(watchlist.html).toContain('href="/positions/VOO"');

    await a.client
      .from("watchlist_items")
      .delete()
      .eq("instrument_id", voo!.id);
  });

  it("otro usuario no ve nada de esta cuenta, ni por pantalla ni por dirección directa (RLS)", async () => {
    expect((await page("/positions", b)).html).toContain(
      "Todavía no cargaste operaciones",
    );
    expect((await page("/activity", b)).html).toContain(
      "Todavía no hay operaciones",
    );
    const otherPosition = await page("/positions/VOO", b);
    expect(otherPosition.html).toContain(NOT_FOUND);
    expect(otherPosition.html).not.toContain("Operaciones (");
    const account = (await getPrimaryAccount(a.client))!;
    const { data } = await a.client
      .from("transactions")
      .select("id")
      .eq("account_id", account.id)
      .limit(1);
    const otherTx = await page(`/activity/${data![0]!.id}`, b);
    expect(otherTx.html).toContain(NOT_FOUND);
    expect(otherTx.html).not.toContain("Guardar cambios");
    // Ni siquiera la exportación: solo sale lo del propio usuario.
    const csv = await (await get("/activity/export", b)).text();
    expect(csv.trimEnd().split("\r\n")).toHaveLength(1); // solo el encabezado
  });
});
