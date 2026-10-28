import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { PERIOD_IDS } from "@/lib/engine";
import type { AssistantDataSource } from "../data-source";
import { MEMORY_KINDS, type MemoryStore } from "../memory";
import type { ToolResult } from "../tool-result";
import { MAX_GROUP_SYMBOLS, getAllocation } from "./allocation";
import { explainMove } from "./explain-move";
import { getGains } from "./gains";
import { searchNews, type NewsDeps } from "./news";
import { getPerformance } from "./performance";
import { getPositions } from "./positions";
import { getPriceHistory } from "./price-history";
import { getRisk } from "./risk";
import { MAX_SIM_TRADES, simulateTrade } from "./simulate-trade";
import { dateInput, fail, symbolInput } from "./shared";
import { MAX_WHAT_IF_AMOUNT, whatIf } from "./what-if";
import { updateMemory } from "./memory";

/** Una fila de telemetría por cada llamada a una tool. */
export interface ToolTiming {
  name: string;
  ok: boolean;
  ms: number;
}

export interface ToolDeps {
  ds: AssistantDataSource;
  /** `null`: sin memoria (los evals). */
  memory: MemoryStore | null;
  /** `null`: sin clave de Tavily, no se ofrece la tool. */
  news: NewsDeps | null;
  /** Se llena a medida que se ejecutan las tools. */
  timings: ToolTiming[];
  /** Para medir cuánto tardó cada tool sin leer el reloj dentro de ellas. */
  clock?: () => number;
}

export const NEWS_TOOL = "search_news";
export const MEMORY_TOOL = "update_memory";

const period = z
  .enum(PERIOD_IDS)
  .describe(
    "1S = última semana, 1M = último mes, 3M = 3 meses, YTD = en lo que va del año, 1A = último año, MAX = todo el historial",
  );

/**
 * Las tools del asistente. Todas leen; ninguna opera ni modifica la cartera (no existe una tool
 * que lo haga). Una excepción adentro de una tool no corta la respuesta: vuelve como error
 * genérico y el detalle queda en el log.
 */
export function buildTools(deps: ToolDeps): ToolSet {
  const clock = deps.clock ?? (() => performance.now());
  const run =
    <I>(name: string, fn: (input: I) => Promise<ToolResult>) =>
    async (input: I): Promise<ToolResult> => {
      const start = clock();
      let result: ToolResult;
      try {
        result = await fn(input);
      } catch (error) {
        console.error(
          `[assistant] tool ${name}`,
          error instanceof Error ? error.message : error,
        );
        result = fail("Hubo un error interno al calcular esto.");
      }
      deps.timings.push({
        name,
        ok: result.ok,
        ms: Math.round(clock() - start),
      });
      return result;
    };

  const { ds } = deps;
  const tools: ToolSet = {
    get_positions: tool({
      description:
        "Posiciones abiertas de hoy con cantidad, precio, valor, peso, costo y ganancia no realizada; además efectivo, valor total, aportado neto, ganancia total y cambio del día.",
      inputSchema: z.object({}),
      execute: run("get_positions", () => getPositions(ds)),
    }),
    get_gains: tool({
      description:
        "Ganancia realizada por activo (ventas) en un período o en todo el historial, y la ganancia no realizada de hoy. Sin fechas: todo el historial.",
      inputSchema: z.object({
        desde: dateInput.optional(),
        hasta: dateInput.optional(),
        simbolo: symbolInput.optional(),
      }),
      execute: run("get_gains", (input) => getGains(ds, input)),
    }),
    get_performance: tool({
      description:
        "Rendimiento de la cartera: TWR, XIRR, ganancia en dinero y comparación con el benchmark para un período fijo (o todos si no se indica). Con desde y hasta: TWR y ganancia de un rango libre.",
      inputSchema: z.object({
        periodo: period.optional(),
        desde: dateInput.optional(),
        hasta: dateInput.optional(),
      }),
      execute: run("get_performance", (input) => getPerformance(ds, input)),
    }),
    explain_move: tool({
      description:
        "Explica qué posiciones hicieron subir o bajar la cartera entre dos fechas (contribución de cada activo, sin contar lo que se compró o vendió).",
      inputSchema: z.object({ desde: dateInput, hasta: dateInput }),
      execute: run("explain_move", (input) => explainMove(ds, input)),
    }),
    get_price_history: tool({
      description:
        "Cómo se movió el precio de un activo entre dos fechas: primer y último cierre, mínimo, máximo y variación.",
      inputSchema: z.object({
        simbolo: symbolInput,
        desde: dateInput,
        hasta: dateInput,
      }),
      execute: run("get_price_history", (input) => getPriceHistory(ds, input)),
    }),
    what_if: tool({
      description:
        "Escenario '¿y si compro?': qué peso tendría un activo en la cartera al comprar un monto con plata nueva, y cómo le habría ido a un aporte mensual de ese monto en el pasado. Es una simulación con precios pasados, no una predicción.",
      inputSchema: z.object({
        simbolo: symbolInput,
        monto: z
          .number()
          .min(1)
          .max(MAX_WHAT_IF_AMOUNT)
          .describe("Monto en dólares"),
      }),
      execute: run("what_if", (input) => whatIf(ds, input)),
    }),
    get_risk: tool({
      description:
        "Riesgo de la cartera: concentración (mayores posiciones y reparto por tipo), caída máxima, distancia al máximo, volatilidad anualizada y mejor/peor día del período (por defecto todo el historial).",
      inputSchema: z.object({ periodo: period.optional() }),
      execute: run("get_risk", (input) => getRisk(ds, input)),
    }),
    simulate_trade: tool({
      description:
        'Simula comprar o vender hoy (sin ejecutar nada) y devuelve cómo quedaría la cartera: peso de cada posición, efectivo y valor total antes y después, y la ganancia que realizaría una venta. Usala siempre que quieras cuantificar una recomendación ("vendé la mitad", "comprá con el efectivo") en vez de calcular vos los pesos o montos resultantes.',
      inputSchema: z.object({
        operaciones: z
          .array(
            z.object({
              simbolo: symbolInput,
              lado: z.enum(["comprar", "vender"]),
              cantidad: z
                .number()
                .positive()
                .optional()
                .describe("Cantidad de acciones o unidades"),
              monto: z
                .number()
                .positive()
                .max(10_000_000)
                .optional()
                .describe("Monto en dólares"),
              fraccion: z
                .number()
                .positive()
                .max(1)
                .optional()
                .describe(
                  "Solo ventas: fracción de la posición (0.5 = la mitad)",
                ),
            }),
          )
          .min(1)
          .max(MAX_SIM_TRADES)
          .describe(
            "Se aplican en orden: lo que libera una venta puede pagar una compra siguiente",
          ),
        fondeo: z
          .enum(["efectivo", "plata_nueva"])
          .optional()
          .describe(
            "Con qué se pagan las compras; por defecto, el efectivo de la cuenta",
          ),
      }),
      execute: run("simulate_trade", (input) => simulateTrade(ds, input)),
    }),
    get_allocation: tool({
      description:
        "Reparto de la cartera con pesos ya calculados: por tipo de activo, por sector, o el peso conjunto de un grupo de símbolos que elijas (por ejemplo, las tecnológicas). Usala en vez de sumar pesos vos.",
      inputSchema: z.object({
        agrupar: z.enum(["tipo", "sector", "simbolos"]),
        simbolos: z
          .array(symbolInput)
          .max(MAX_GROUP_SYMBOLS)
          .optional()
          .describe("Solo con agrupar = simbolos"),
      }),
      execute: run("get_allocation", (input) => getAllocation(ds, input)),
    }),
  };

  if (deps.news) {
    const news = deps.news;
    tools[NEWS_TOOL] = tool({
      description:
        "Busca noticias recientes de un activo en internet. Devuelve títulos, fecha, sitio, link y un extracto. Es contenido de terceros.",
      inputSchema: z.object({
        simbolo: symbolInput,
        tema: z
          .string()
          .max(60)
          .optional()
          .describe("Nombre de la empresa o tema para afinar la búsqueda"),
        dias: z.number().int().min(1).max(30).optional(),
      }),
      execute: run(NEWS_TOOL, (input) => searchNews(news, input)),
    });
  }

  if (deps.memory) {
    const memory = deps.memory;
    tools[MEMORY_TOOL] = tool({
      description:
        "Guarda, corrige o borra un dato estable que la persona contó sobre sí misma: perfil de riesgo, objetivos o preferencias. Nunca montos, porcentajes ni datos de la cartera. Solo cuando la persona lo dice explícitamente.",
      inputSchema: z.object({
        accion: z.enum(["agregar", "actualizar", "borrar"]),
        tipo: z.enum(MEMORY_KINDS).optional(),
        texto: z.string().max(400).optional(),
        id: z.string().max(64).optional(),
      }),
      execute: run(MEMORY_TOOL, (input) => updateMemory(memory, input)),
    });
  }

  return tools;
}
