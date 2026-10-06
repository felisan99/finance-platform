import { describe, expect, it } from "vitest";
import { buildScriptableScript } from "../script";
import type { WidgetView } from "../view";

// Ejecuta el script de Scriptable con una imitación mínima de sus APIs (ListWidget, stacks, textos,
// Keychain, Request…) y lee lo que dibuja: qué textos quedan, en qué orden y en qué fila. No mide
// tamaños ni colores reales (eso solo se ve en el teléfono), pero sí el contenido de cada tamaño.

const ORIGIN = "https://portfolio.example.com";
const TOKEN = `ptw_${"a".repeat(43)}`;

interface TextNode {
  kind: "text";
  text: string;
  color: unknown;
  centerAlignText(): void;
}
interface SpacerNode {
  kind: "spacer";
}
interface StackNode {
  kind: "stack";
  horizontal: boolean;
  children: Array<TextNode | SpacerNode | StackNode>;
}

function makeStack(): StackNode & Record<string, unknown> {
  const stack: StackNode & Record<string, unknown> = {
    kind: "stack",
    horizontal: false,
    children: [],
    layoutHorizontally() {
      stack.horizontal = true;
    },
    layoutVertically() {
      stack.horizontal = false;
    },
    centerAlignContent() {},
    setPadding() {},
    addText(text: string) {
      const node: TextNode = {
        kind: "text",
        text,
        color: null,
        centerAlignText() {},
      };
      stack.children.push(node);
      return node;
    },
    addSpacer() {
      stack.children.push({ kind: "spacer" });
    },
    addStack() {
      const child = makeStack();
      stack.children.push(child);
      return child;
    },
  };
  return stack;
}

/** Las líneas que se leen: un stack horizontal es una fila (`A | B`); uno vertical, varias. */
function lines(node: StackNode): string[] {
  if (node.horizontal) {
    const cells = node.children.flatMap((child) =>
      child.kind === "text"
        ? [child.text]
        : child.kind === "stack"
          ? [lines(child).join(" ")]
          : [],
    );
    return cells.length > 0 ? [cells.join(" | ")] : [];
  }
  return node.children.flatMap((child) =>
    child.kind === "text"
      ? [child.text]
      : child.kind === "stack"
        ? lines(child)
        : [],
  );
}

async function run(options: {
  family: string;
  status?: number;
  body?: unknown;
  token?: string | null;
  /** El campo «Parameter» del widget. */
  parameter?: string | null;
  /** Sin conexión: el pedido falla. */
  offline?: boolean;
  /** Los archivos del teléfono (para probar el último resumen entre corridas). */
  files?: Map<string, string>;
}) {
  const files = options.files ?? new Map<string, string>();
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  let shown: StackNode | null = null;

  class ListWidget {
    constructor() {
      Object.assign(this, makeStack());
    }
    presentMedium() {}
  }
  class Color {
    constructor(readonly hex: string) {}
    static dynamic(light: Color, dark: Color) {
      return { light: light.hex, dark: dark.hex };
    }
  }
  class Size {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}
  }
  class Request {
    headers: Record<string, string> = {};
    response: { statusCode: number } | null = null;
    timeoutInterval = 0;
    constructor(readonly url: string) {}
    async loadString() {
      requests.push({ url: this.url, headers: this.headers });
      if (options.offline) throw new Error("sin conexión");
      this.response = { statusCode: options.status ?? 200 };
      return JSON.stringify(options.body ?? {});
    }
  }
  class DateFormatter {
    dateFormat = "";
    string(date: Date) {
      return date.toISOString().slice(11, 16);
    }
  }
  const font = (weight: string) => (size: number) => ({ weight, size });
  const token = options.token === undefined ? TOKEN : options.token;
  const globals = {
    ListWidget,
    Color,
    Size,
    Request,
    DateFormatter,
    Font: {
      boldSystemFont: font("bold"),
      semiboldSystemFont: font("semibold"),
      systemFont: font("regular"),
    },
    Keychain: {
      contains: () => token !== null,
      get: () => token,
      set() {},
      remove() {},
    },
    FileManager: {
      local: () => ({
        joinPath: (a: string, b: string) => `${a}/${b}`,
        cacheDirectory: () => "/cache",
        fileExists: (path: string) => files.has(path),
        writeString: (path: string, text: string) => files.set(path, text),
        readString: (path: string) => files.get(path) ?? "",
        remove: (path: string) => files.delete(path),
        listContents: (dir: string) =>
          [...files.keys()]
            .filter((path) => path.startsWith(`${dir}/`))
            .map((path) => path.slice(dir.length + 1)),
      }),
    },
    config: {
      runsInWidget: true,
      runsInApp: false,
      widgetFamily: options.family,
    },
    Script: {
      setWidget(widget: StackNode) {
        shown = widget;
      },
      complete() {},
    },
    Alert: class {},
    args: { widgetParameter: options.parameter ?? null },
  };

  const AsyncFunction = Object.getPrototypeOf(async () => {})
    .constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  const script = new AsyncFunction(
    ...Object.keys(globals),
    buildScriptableScript(ORIGIN),
  );
  await script(...Object.values(globals));
  if (!shown) throw new Error("el script no mostró ningún widget");
  return { lines: lines(shown), requests, files };
}

const view: WidgetView = {
  version: 1,
  generatedAt: "2026-10-06T19:53:00.000Z",
  title: "Portafolio principal",
  hasTransactions: true,
  totalValue: "US$ 10.691,47",
  partial: false,
  dayChange: "+US$ 49,62",
  dayChangePct: "+0,47%",
  dayTone: "gain",
  totalGain: "+US$ 1.171,47",
  totalGainPct: "+12,31%",
  gainTone: "gain",
  pricesAsOf: "06/10",
  pricesToday: true,
  positions: [
    {
      symbol: "VOO",
      value: "US$ 6.823,12",
      dayChangePct: "+0,52%",
      dayTone: "gain",
    },
    {
      symbol: "SOXX",
      value: "US$ 1.781,34",
      dayChangePct: "+1,10%",
      dayTone: "gain",
    },
    {
      symbol: "DDOG",
      value: "US$ 554,36",
      dayChangePct: "-0,84%",
      dayTone: "loss",
    },
    {
      symbol: "QQQ",
      value: "US$ 500,00",
      dayChangePct: "+0,00%",
      dayTone: "flat",
    },
    { symbol: "AAA", value: "US$ 20,00", dayChangePct: null, dayTone: null },
  ],
};

describe("el script de Scriptable, ejecutado", () => {
  it("consulta /api/widget con el código en la cabecera", async () => {
    const { requests } = await run({ family: "small", body: view });
    expect(requests).toEqual([
      {
        url: `${ORIGIN}/api/widget`,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/json",
        },
      },
    ]);
  });

  it("mediano: «Hoy» como la ganancia total, 4 posiciones con su cambio del día y el pie", async () => {
    const { lines: drawn } = await run({ family: "medium", body: view });
    expect(drawn).toEqual([
      "Portafolio principal US$ 10.691,47 Hoy ▲ +US$ 49,62 (+0,47%) | Ganancia total ▲ +US$ 1.171,47 (+12,31%) VOO | ▲ +0,52% SOXX | ▲ +1,10% DDOG | ▼ -0,84% QQQ | +0,00%",
      "Actualizado 19:53",
    ]);
  });

  it("chico: el resumen sin posiciones", async () => {
    const { lines: drawn } = await run({ family: "small", body: view });
    expect(drawn).toEqual([
      "Portafolio principal",
      "US$ 10.691,47",
      "Hoy",
      "▲ +US$ 49,62 (+0,47%)",
      "Actualizado 19:53",
    ]);
  });

  it("grande: 6 posiciones como mucho, con valor y cambio; sin cierre anterior, una raya", async () => {
    const { lines: drawn } = await run({ family: "large", body: view });
    expect(drawn).toEqual([
      "Portafolio principal",
      "US$ 10.691,47",
      "Hoy",
      "▲ +US$ 49,62 (+0,47%)",
      "Ganancia total",
      "▲ +US$ 1.171,47 (+12,31%)",
      "VOO | US$ 6.823,12 | ▲ +0,52%",
      "SOXX | US$ 1.781,34 | ▲ +1,10%",
      "DDOG | US$ 554,36 | ▼ -0,84%",
      "QQQ | US$ 500,00 | +0,00%",
      "AAA | US$ 20,00 | —",
      "Actualizado 19:53",
    ]);
  });

  it("si los precios no son de hoy, el pie dice de qué día; también avisa un total parcial", async () => {
    const { lines: drawn } = await run({
      family: "small",
      body: { ...view, pricesToday: false, pricesAsOf: "03/10", partial: true },
    });
    expect(drawn.at(-1)).toBe(
      "Total parcial · Actualizado 19:53 · precios al 03/10",
    );
  });

  it("una respuesta del servidor anterior (sin los campos nuevos) se sigue dibujando", async () => {
    const old = {
      ...view,
      pricesToday: undefined,
      positions: view.positions.map(({ symbol, value }) => ({ symbol, value })),
    };
    const { lines: drawn } = await run({ family: "large", body: old });
    expect(drawn).toContain("VOO | US$ 6.823,12 | —");
    expect(drawn.at(-1)).toBe("Actualizado 19:53 · precios al 06/10");
  });

  it("sin operaciones, lo dice", async () => {
    const { lines: drawn } = await run({
      family: "medium",
      body: { ...view, hasTransactions: false, positions: [] },
    });
    expect(drawn).toEqual([
      "Portafolio principal",
      "Todavía no cargaste operaciones.",
    ]);
  });

  it("pantalla de bloqueo: total y cambio del día", async () => {
    const { lines: drawn } = await run({
      family: "accessoryRectangular",
      body: view,
    });
    expect(drawn).toEqual([
      "Portafolio principal",
      "US$ 10.691,47",
      "Hoy ▲ +0,47%",
    ]);
  });

  it("errores: código revocado, sin código, demasiadas consultas", async () => {
    expect((await run({ family: "medium", status: 401 })).lines[0]).toBe(
      "Código revocado o incorrecto",
    );
    expect((await run({ family: "medium", token: null })).lines[0]).toBe(
      "Falta tu código",
    );
    expect((await run({ family: "medium", status: 429 })).lines[0]).toBe(
      "Demasiadas consultas",
    );
  });

  describe("un widget por portafolio (campo Parameter)", () => {
    it("manda el nombre en la consulta, codificado", async () => {
      const { requests } = await run({
        family: "small",
        body: view,
        parameter: "  Jubilación & más ",
      });
      expect(requests[0]?.url).toBe(
        `${ORIGIN}/api/widget?portfolio=${encodeURIComponent("Jubilación & más")}`,
      );
    });

    it("sin Parameter no manda nada (lo que eligió el código)", async () => {
      const { requests } = await run({
        family: "small",
        body: view,
        parameter: "",
      });
      expect(requests[0]?.url).toBe(`${ORIGIN}/api/widget`);
    });

    it("si el portafolio no existe o el código no lo incluye, lo dice con el nombre", async () => {
      const { lines: drawn } = await run({
        family: "medium",
        status: 404,
        parameter: "Cripto",
      });
      expect(drawn[0]).toBe("No encontré «Cripto»");
    });

    it("sin conexión, cada widget muestra su propio último resumen", async () => {
      const files = new Map<string, string>();
      const crypto = { ...view, title: "Cripto", totalValue: "US$ 50,00" };
      await run({ family: "small", body: view, parameter: "", files });
      await run({ family: "small", body: crypto, parameter: "Cripto", files });
      expect(files.size).toBe(2);

      const offlineCrypto = await run({
        family: "small",
        parameter: "cripto",
        offline: true,
        files,
      });
      expect(offlineCrypto.lines.slice(0, 2)).toEqual(["Cripto", "US$ 50,00"]);
      expect(offlineCrypto.lines.at(-1)).toBe(
        "Sin conexión · Actualizado 19:53",
      );

      const offlineAll = await run({ family: "small", offline: true, files });
      expect(offlineAll.lines[1]).toBe("US$ 10.691,47");
    });

    it("un código revocado borra el resumen de ese widget", async () => {
      const files = new Map<string, string>();
      await run({ family: "small", body: view, parameter: "Cripto", files });
      await run({ family: "small", body: view, files });
      await run({ family: "small", status: 401, parameter: "Cripto", files });
      expect([...files.keys()]).toEqual([
        "/cache/portfolio-tracker-widget.json",
      ]);
    });
  });
});
