import { spawn, type ChildProcess } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAdmin,
  assertDevProject,
  deleteTestUser,
  type DbClient,
} from "@/lib/db/__tests__/integration-helpers";
import type { Database, Json } from "@/lib/db/database.types";
import { validateLedgerChange } from "@/lib/engine";
import { ensureInstruments } from "@/lib/market-jobs/instruments";
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
      "/activity/export",
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location"), path).toMatch(/\/login$/);
    }
  });

  it("una cuenta nueva ve los estados vacíos, con los caminos para empezar", async () => {
    const home = await page("/", a);
    expect(home.status).toBe(200);
    expect(home.html).toContain("Todavía no cargaste operaciones");
    expect(home.html).toContain("Importar CSV de Delta");
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
    expect(imported.html).toContain("Archivo CSV de Delta");
    expect(imported.html).toContain("Ver vista previa");
  });

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
