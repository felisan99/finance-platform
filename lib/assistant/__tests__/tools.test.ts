import { describe, expect, it, vi } from "vitest";
import {
  addDays,
  computeAllocation,
  d,
  summarizeRealized,
  realizedEvents,
} from "@/lib/engine";
import {
  formatMoney,
  formatPercent,
  formatPrice,
} from "@/lib/portfolio/format";
import { demoDataSource } from "../fixture/demo-data-source";
import { demoNews, demoWeb, inMemoryStore } from "../fixture/demo-deps";
import { DEMO_NOW } from "../fixture/demo-portfolio";
import type { MemoryItem, MemoryStore } from "../memory";
import { TOOL_ACTIVITY, TOOL_LABELS, type ToolResult } from "../tool-result";
import { getAllocation } from "../tools/allocation";
import { explainMove } from "../tools/explain-move";
import { getGains } from "../tools/gains";
import {
  ASSET_TOOL,
  buildTools,
  MAX_ASSET_LOOKUPS,
  MEMORY_TOOL,
  NEWS_TOOL,
  WEB_TOOL,
} from "../tools";
import { getAssetInfo } from "../tools/asset-info";
import { webSearch, type WebSearchDeps } from "../tools/web-search";
import { updateMemory } from "../tools/memory";
import { searchNews, type NewsDeps } from "../tools/news";
import { getPerformance } from "../tools/performance";
import { getPositions } from "../tools/positions";
import { getPriceHistory } from "../tools/price-history";
import { getRisk } from "../tools/risk";
import { checkRange, checkSymbol } from "../tools/shared";
import { simulateTrade } from "../tools/simulate-trade";
import { whatIf } from "../tools/what-if";

type Ok = Extract<ToolResult, { ok: true }>;
// Los datos de las tools son JSON para el modelo; en los tests se leen como registros.
type Data = Record<string, unknown>;

function expectOk(result: ToolResult): Ok & { data: Data } {
  if (!result.ok) throw new Error(`se esperaba ok: ${result.error}`);
  return result as Ok & { data: Data };
}

describe("checkRange y checkSymbol", () => {
  it("acepta un rango válido y recorta el futuro a hoy", () => {
    expect(checkRange("2026-09-01", "2026-12-31", DEMO_NOW)).toEqual({
      ok: true,
      from: "2026-09-01",
      to: "2026-09-30",
      clipped: true,
    });
  });

  it("rechaza fechas imposibles, rangos al revés y rangos futuros", () => {
    expect(checkRange("2026-02-30", "2026-03-01", DEMO_NOW).ok).toBe(false);
    expect(checkRange("2026-09-10", "2026-09-01", DEMO_NOW).ok).toBe(false);
    expect(checkRange("2026-10-05", "2026-10-06", DEMO_NOW).ok).toBe(false);
    expect(checkRange("01/09/2026", "2026-09-30", DEMO_NOW).ok).toBe(false);
  });

  it("normaliza símbolos como los formularios y rechaza basura", () => {
    expect(checkSymbol(" brk.b ")).toEqual({ ok: true, symbol: "BRK-B" });
    expect(checkSymbol("btc-usd")).toEqual({ ok: true, symbol: "BTC-USD" });
    expect(checkSymbol("AAPL; DROP").ok).toBe(false);
    expect(checkSymbol("").ok).toBe(false);
  });
});

describe("get_positions", () => {
  it("devuelve lo mismo que valúa Inicio, ya formateado, y avisa del símbolo sin precio", async () => {
    const ds = demoDataSource();
    const result = expectOk(await getPositions(ds));
    const { valued } = await ds.snapshot();
    expect(result.data.valor_total).toBe(formatMoney(valued.totalValue));
    expect(result.data.efectivo).toBe(formatMoney(valued.cash));
    expect(valued.cash.gt(0)).toBe(true);
    expect(result.source.fn).toBe("valuePortfolio");
    expect(result.missing.some((m) => m.includes("XNEW"))).toBe(true);
    // Con un precio faltante, la ganancia total no se calcula: se dice, no se inventa.
    expect(result.data.ganancia_total).toBe("—");

    const symbols = (result.data.posiciones as Data[]).map((p) => p.simbolo);
    expect(symbols).toContain("NVDA");
    expect(symbols).not.toContain("MSFT");
    const closed = (result.data.posiciones_cerradas as Data[]).map(
      (p) => p.simbolo,
    );
    expect(closed).toEqual(["MSFT"]);
  });

  it("las cantidades reflejan el split y las ventas parciales", async () => {
    const result = expectOk(await getPositions(demoDataSource()));
    const bySymbol = new Map(
      (result.data.posiciones as Data[]).map((p) => [p.simbolo, p]),
    );
    expect(bySymbol.get("NVDA")?.cantidad).toBe("25"); // 10 × 4 − 15
    expect(bySymbol.get("AAPL")?.cantidad).toBe("15"); // 30 − 10 − 5
    expect(bySymbol.get("XNEW")?.valor).toBe("—");
  });
});

describe("get_gains", () => {
  it("el realizado de un período coincide con el motor y la no realizada es la de hoy", async () => {
    const ds = demoDataSource();
    const snapshot = await ds.snapshot();
    const expected = summarizeRealized(
      realizedEvents(snapshot.parts[0]!.transactions),
      "2025-01-01",
      "2025-12-31",
    );
    const result = expectOk(
      await getGains(ds, { desde: "2025-01-01", hasta: "2025-12-31" }),
    );
    expect(result.data.realizada_total).toBe(
      formatMoney(expected.total, { signed: true }),
    );
    expect(
      (result.data.realizada_por_activo as Data[]).map((r) => r.simbolo).sort(),
    ).toEqual(["MSFT", "NVDA"]);
    expect(result.source.detail).toBe("01/01/2025 – 31/12/2025");
  });

  it("filtra por símbolo y dice cuando no hay operaciones de ese símbolo", async () => {
    const ds = demoDataSource();
    const aapl = expectOk(await getGains(ds, { simbolo: "aapl" }));
    expect(aapl.data.ventas).toBe(2);
    const none = expectOk(await getGains(ds, { simbolo: "TSLA" }));
    expect(none.missing.some((m) => m.includes("TSLA"))).toBe(true);
  });

  it("pide las dos fechas", async () => {
    expect((await getGains(demoDataSource(), { desde: "2025-01-01" })).ok).toBe(
      false,
    );
  });
});

describe("get_performance y explain_move", () => {
  it("los períodos son los del motor, formateados", async () => {
    const ds = demoDataSource();
    const performance = (await ds.performance())!;
    const result = expectOk(await getPerformance(ds, { periodo: "1A" }));
    const [period] = result.data.periodos as Data[];
    const expected = performance.result.periods.find((p) => p.id === "1A")!;
    expect(period?.rendimiento_twr).toBe(
      formatPercent(expected.twr, { signed: true }),
    );
    expect(period?.ganancia_en_dinero).toBe(
      formatMoney(expected.gain, { signed: true }),
    );
    expect(result.data.benchmark).toBe("S&P 500");
  });

  it("la ganancia de explain_move en el último año es la misma que la del período 1A", async () => {
    const ds = demoDataSource();
    const performance = (await ds.performance())!;
    const year = performance.result.periods.find((p) => p.id === "1A")!;
    const result = expectOk(
      await explainMove(ds, {
        desde: addDays(year.baseDate, 1),
        hasta: year.endDate,
      }),
    );
    expect(result.data.ganancia_del_periodo).toBe(
      formatMoney(year.gain, { signed: true }),
    );
    expect(result.source.fn).toBe("contributionBetween");
  });

  it("un rango libre devuelve el TWR del motor y su ganancia", async () => {
    const ds = demoDataSource();
    const result = expectOk(
      await getPerformance(ds, { desde: "2026-09-01", hasta: "2026-09-30" }),
    );
    expect(result.source.fn).toBe("computeTwr");
    expect(typeof result.data.rendimiento_twr).toBe("string");
    expect(result.data.ganancia_en_dinero).not.toBeNull();
  });

  it("explain_move con XNEW sin precio lo informa en missing", async () => {
    const result = expectOk(
      await explainMove(demoDataSource(), {
        desde: "2026-01-01",
        hasta: "2026-06-30",
      }),
    );
    expect(result.missing.some((m) => m.includes("XNEW"))).toBe(true);
  });
});

describe("get_price_history, what_if y get_risk", () => {
  it("resume los cierres y no inventa los que no hay", async () => {
    const ds = demoDataSource();
    const amzn = expectOk(
      await getPriceHistory(ds, {
        simbolo: "AMZN",
        desde: "2026-01-01",
        hasta: "2026-06-30",
      }),
    );
    expect(amzn.data.cierres_en_el_rango).toBeGreaterThan(100);
    const xnew = expectOk(
      await getPriceHistory(ds, {
        simbolo: "XNEW",
        desde: "2026-01-01",
        hasta: "2026-06-30",
      }),
    );
    expect(xnew.missing).toHaveLength(1);
    const unknown = expectOk(
      await getPriceHistory(ds, {
        simbolo: "TSLA",
        desde: "2026-01-01",
        hasta: "2026-06-30",
      }),
    );
    expect(unknown.missing[0]).toContain("no está en la base");
  });

  it("what_if usa el mismo cálculo que «Antes de comprar» y avisa que no predice nada", async () => {
    const result = expectOk(
      await whatIf(demoDataSource(), { simbolo: "KO", monto: 1000 }),
    );
    expect(
      (result.data.compra_unica_con_plata_nueva as Data[])[0]?.concepto,
    ).toBe("KO en tu cartera");
    expect(result.notes.join(" ")).toContain("no predice nada");
    expect(
      (await whatIf(demoDataSource(), { simbolo: "KO", monto: 0 })).ok,
    ).toBe(false);
  });

  it("get_risk trae concentración y caídas del período", async () => {
    const result = expectOk(await getRisk(demoDataSource(), { periodo: "1A" }));
    expect((result.data.concentracion as Data).mayores_posiciones).toHaveLength(
      5,
    );
    expect(result.data.volatilidad_anualizada).toMatch(/%$/);
    expect(result.source.detail.startsWith("1A")).toBe(true);
  });
});

describe("simulate_trade", () => {
  it("vender la mitad de NVDA: el peso de antes es el de Inicio y baja después", async () => {
    const ds = demoDataSource();
    const positions = expectOk(await getPositions(ds));
    const nvda = (positions.data.posiciones as Data[]).find(
      (p) => p.simbolo === "NVDA",
    )!;
    const result = expectOk(
      await simulateTrade(ds, {
        operaciones: [
          { simbolo: "nvda", lado: "vender", medida: "fraccion", valor: 0.5 },
        ],
      }),
    );
    const [trade] = result.data.operaciones as Data[];
    expect(trade?.peso_antes).toBe(nvda.peso);
    expect(trade?.cantidad).toBe("12,5");
    expect(trade?.ganancia_realizada_estimada).toMatch(/^\+US\$/);
    expect((result.data.antes as Data).valor_total).toBe(
      positions.data.valor_total,
    );
    // Vender con el efectivo como destino no cambia el total.
    expect((result.data.despues as Data).valor_total).toBe(
      positions.data.valor_total,
    );
    expect(result.source.fn).toBe("simulateTrades");
  });

  it("comprar algo que no está en la cartera usa su último cierre; con plata nueva sube el total", async () => {
    const result = expectOk(
      await simulateTrade(demoDataSource(), {
        operaciones: [
          { simbolo: "SPY", lado: "comprar", medida: "dolares", valor: 1000 },
        ],
        fondeo: "plata_nueva",
      }),
    );
    expect(result.data.plata_nueva_a_depositar).toBe("US$\u00a01.000,00");
    expect((result.data.operaciones as Data[])[0]?.peso_antes).toBe("0,00%");
  });

  it("un símbolo sin cierres guardados se simula con su cotización de hoy", async () => {
    const result = expectOk(
      await simulateTrade(demoDataSource(), {
        operaciones: [
          { simbolo: "ORCL", lado: "comprar", medida: "acciones", valor: 10 },
        ],
        fondeo: "plata_nueva",
      }),
    );
    const [trade] = result.data.operaciones as Data[];
    expect(trade?.precio).toContain("182,50");
    expect(trade?.monto).toContain("1.825,00");
  });

  it("sin fondeo y sin efectivo suficiente simula con plata nueva y lo avisa", async () => {
    const operaciones = [
      {
        simbolo: "SPY",
        lado: "comprar" as const,
        medida: "dolares" as const,
        valor: 5_000_000,
      },
    ];
    const result = expectOk(
      await simulateTrade(demoDataSource(), { operaciones }),
    );
    expect(result.data.plata_nueva_a_depositar).not.toBeNull();
    expect(result.notes?.join(" ")).toContain("plata nueva");
    // Pidiendo el efectivo de forma explícita, sigue fallando.
    expect(
      (
        await simulateTrade(demoDataSource(), {
          operaciones,
          fondeo: "efectivo",
        })
      ).ok,
    ).toBe(false);
  });

  it("rechaza vender más de lo que hay, símbolos sin precio y listas vacías", async () => {
    const ds = demoDataSource();
    expect(
      (
        await simulateTrade(ds, {
          operaciones: [
            {
              simbolo: "NVDA",
              lado: "vender",
              medida: "acciones",
              valor: 1000,
            },
          ],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await simulateTrade(ds, {
          operaciones: [
            { simbolo: "XNEW", lado: "vender", medida: "fraccion", valor: 0.5 },
          ],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await simulateTrade(ds, {
          operaciones: [
            { simbolo: "TSLA", lado: "comprar", medida: "dolares", valor: 100 },
          ],
        })
      ).ok,
    ).toBe(false);
    expect((await simulateTrade(ds, { operaciones: [] })).ok).toBe(false);
  });
});

describe("get_allocation", () => {
  it("el peso conjunto de varios símbolos es el del motor", async () => {
    const ds = demoDataSource();
    const { valued } = await ds.snapshot();
    const chosen = new Set(["NVDA", "AMZN", "AAPL"]);
    const expected = computeAllocation(valued, (s) =>
      chosen.has(s) ? "Seleccionados" : "Resto",
    ).slices.find((slice) => slice.key === "Seleccionados")!;
    const result = expectOk(
      await getAllocation(ds, {
        agrupar: "simbolos",
        simbolos: ["nvda", "AMZN", "aapl", "TSLA"],
      }),
    );
    const group = (result.data.grupos as Data[]).find(
      (g) => g.grupo === "Seleccionados",
    )!;
    expect(group.peso).toBe(formatPercent(expected.weight));
    expect(result.data.por_simbolo as Data[]).toHaveLength(3);
    expect(result.missing).toContain("TSLA no está en la cartera.");
  });

  it("por tipo y por sector", async () => {
    const ds = demoDataSource();
    const byType = expectOk(await getAllocation(ds, { agrupar: "tipo" }));
    expect((byType.data.grupos as Data[]).map((g) => g.grupo)).toEqual(
      expect.arrayContaining(["Acción", "ETF", "Cripto", "Efectivo"]),
    );
    const bySector = expectOk(await getAllocation(ds, { agrupar: "sector" }));
    expect((bySector.data.grupos as Data[]).map((g) => g.grupo)).toEqual(
      expect.arrayContaining(["Technology", "ETF", "Cripto"]),
    );
    expect(byType.missing.some((m) => m.includes("XNEW"))).toBe(true);
  });

  it("pide al menos un símbolo", async () => {
    expect(
      (await getAllocation(demoDataSource(), { agrupar: "simbolos" })).ok,
    ).toBe(false);
  });
});

function memoryStore(): MemoryStore & { items: MemoryItem[] } {
  const items: MemoryItem[] = [];
  return {
    items,
    list: async () => items,
    add: async (kind, content) => {
      const item = {
        id: `00000000-0000-4000-8000-${String(items.length).padStart(12, "0")}`,
        kind,
        content,
        updatedAt: "2026-09-30T00:00:00Z",
      };
      items.push(item);
      return item;
    },
    update: async (id, content) => {
      const item = items.find((i) => i.id === id);
      if (!item) return null;
      item.content = content;
      return item;
    },
    remove: async (id) => {
      const index = items.findIndex((i) => i.id === id);
      if (index < 0) return false;
      items.splice(index, 1);
      return true;
    },
  };
}

describe("update_memory", () => {
  it("guarda un perfil y rechaza montos y porcentajes", async () => {
    const store = memoryStore();
    expect(
      (
        await updateMemory(store, {
          accion: "agregar",
          tipo: "risk_profile",
          texto: "Perfil moderado, invierte para jubilarse en 25 años",
        })
      ).ok,
    ).toBe(true);
    for (const texto of [
      "Tiene US$ 5.000 en efectivo",
      "Quiere 20% en bonos",
      "Compró 300 acciones",
      "Su costo promedio es 12,5",
    ]) {
      const result = await updateMemory(store, {
        accion: "agregar",
        tipo: "fact",
        texto,
      });
      expect(result.ok, texto).toBe(false);
    }
    expect(store.items).toHaveLength(1);
  });

  it("actualiza y borra por id, y pide el tipo al agregar", async () => {
    const store = memoryStore();
    await updateMemory(store, {
      accion: "agregar",
      tipo: "goal",
      texto: "Comprar una casa",
    });
    const id = store.items[0]!.id;
    expect(
      (await updateMemory(store, { accion: "actualizar", id, texto: "Viajar" }))
        .ok,
    ).toBe(true);
    expect(store.items[0]!.content).toBe("Viajar");
    expect((await updateMemory(store, { accion: "borrar", id })).ok).toBe(true);
    expect(
      (await updateMemory(store, { accion: "agregar", texto: "Sin tipo" })).ok,
    ).toBe(false);
  });
});

describe("search_news", () => {
  const deps = (over: Partial<NewsDeps> = {}): NewsDeps => ({
    search: { search: vi.fn(async () => []) },
    takeLimit: async () => true,
    holds: async () => true,
    ...over,
  });

  it("respeta el límite diario y no llama a Tavily si se pasó", async () => {
    const search = vi.fn(async () => []);
    const result = await searchNews(
      deps({ search: { search }, takeLimit: async () => false }),
      { simbolo: "NVDA" },
    );
    expect(result.ok).toBe(false);
    expect(search).not.toHaveBeenCalled();
  });

  it("a Tavily solo le llega el símbolo (y el tema), nunca datos de la cartera", async () => {
    const search = vi.fn(async () => [
      {
        title: "Título",
        url: "https://example.com/a",
        publishedAt: "2026-09-29",
        site: "example.com",
        snippet: "Extracto",
      },
    ]);
    const result = expectOk(
      await searchNews(deps({ search: { search } }), {
        simbolo: "nvda",
        tema: "Nvidia",
        dias: 99,
      }),
    );
    expect(search).toHaveBeenCalledWith("NVDA Nvidia stock news", 30);
    expect((result.data.contenido_externo as Data[])[0]?.fecha).toBe(
      "29/09/2026",
    );
  });

  it("un fallo de Tavily vuelve como error legible", async () => {
    const search = vi.fn(async () => {
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await searchNews(deps({ search: { search } }), {
      simbolo: "NVDA",
    });
    expect(result).toEqual({
      ok: false,
      error: "No pude buscar noticias en este momento.",
    });
  });
});

describe("buildTools", () => {
  it("sin memoria ni noticias no ofrece esas tools, y ninguna tool escribe en la cartera", () => {
    const tools = buildTools({
      ds: demoDataSource(),
      memory: null,
      news: null,
      timings: [],
    });
    expect(Object.keys(tools).sort()).toEqual([
      "explain_move",
      "get_allocation",
      "get_asset_info",
      "get_gains",
      "get_performance",
      "get_positions",
      "get_price_history",
      "get_risk",
      "simulate_trade",
      "what_if",
    ]);
    expect(tools[MEMORY_TOOL]).toBeUndefined();
    expect(tools[NEWS_TOOL]).toBeUndefined();
    expect(tools[WEB_TOOL]).toBeUndefined();
  });

  it("cada descripción dice cuándo usar la tool, y las de datos llevan la regla de los números", () => {
    const tools = buildTools({
      ds: demoDataSource(),
      memory: inMemoryStore(),
      news: {
        search: demoNews,
        takeLimit: async () => true,
        holds: async () => false,
      },
      web: { search: demoWeb, takeLimit: async () => true },
      timings: [],
    });
    expect(tools[WEB_TOOL]).toBeDefined();
    for (const [name, definition] of Object.entries(tools)) {
      expect(definition.description, name).toMatch(/Usala/);
      expect(TOOL_LABELS[name], name).toBeDefined();
      expect(TOOL_ACTIVITY[name], name).toBeDefined();
      if (name !== NEWS_TOOL && name !== MEMORY_TOOL && name !== WEB_TOOL) {
        expect(definition.description, name).toContain("copialos tal cual");
      }
    }
    expect(tools.simulate_trade!.description).toContain("medida: 'fraccion'");
  });

  it("registra cada llamada y convierte una excepción en un error genérico", async () => {
    const timings: Parameters<typeof buildTools>[0]["timings"] = [];
    const ds = demoDataSource();
    ds.snapshot = async () => {
      throw new Error("db caída");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 0;
    const tools = buildTools({
      ds,
      memory: null,
      news: null,
      timings,
      clock: () => (now += 5),
    });
    const output = await tools.get_positions!.execute!({}, {
      toolCallId: "1",
      messages: [],
    } as never);
    expect(output).toEqual({
      ok: false,
      error: "Hubo un error interno al calcular esto.",
    });
    expect(timings).toEqual([{ name: "get_positions", ok: false, ms: 5 }]);
  });
});

describe("get_asset_info", () => {
  it("un activo fuera de la cartera: precio, cambio, datos y trimestres ya formateados", async () => {
    const result = expectOk(
      await getAssetInfo(demoDataSource(), { simbolo: "orcl" }),
    );
    expect(result.source.fn).toBe("Yahoo Finance");
    expect(result.data).toMatchObject({
      simbolo: "ORCL",
      nombre: "Demo Oracle",
      tipo: "Acción",
      precio: formatPrice(d("182.5"), { currency: true }),
      cambio_del_dia: formatPercent(d("0.012483"), { signed: true }),
      cambio_del_dia_usd: formatMoney(d("2.25"), { signed: true }),
      proximos_resultados: "Próximos resultados: 10/12/2026",
    });
    const datos = result.data.datos as Record<string, string>;
    expect(datos["Rango de 52 semanas"]).toBe("US$ 120,10 – 198,40");
    expect(datos["P/E (12 meses)"]).toBe("41,20");
    expect(datos["Capitalización bursátil"]).toBe("US$ 512 mil millones");
    const quarters = result.data.ultimos_trimestres as string[];
    expect(quarters).toHaveLength(2);
    expect(quarters[0]).toContain("superó");
    expect(result.missing).toEqual([]);
  });

  it("un ETF avisa que el costo anual no está y no inventa ganancias trimestrales", async () => {
    const result = expectOk(
      await getAssetInfo(demoDataSource(), { simbolo: "VXUS" }),
    );
    expect(result.data).toMatchObject({ tipo: "ETF", ultimos_trimestres: [] });
    expect((result.data.datos as Record<string, string>).Categoría).toBe(
      "Foreign Large Blend",
    );
    expect(result.missing.join(" ")).toMatch(/TER/);
  });

  it("un activo de la cartera trae su cotización; sin datos de empresa lo dice en missing", async () => {
    const result = expectOk(
      await getAssetInfo(demoDataSource(), { simbolo: "NVDA" }),
    );
    expect(result.data.precio).toMatch(/^US\$\s/);
    expect(result.missing).toEqual([
      "No pude obtener los datos de la empresa o del fondo de NVDA.",
    ]);
  });

  it("símbolo inválido, inexistente, proveedor caído y límite: nunca inventa", async () => {
    const ds = demoDataSource();
    expect((await getAssetInfo(ds, { simbolo: "AAPL; DROP" })).ok).toBe(false);

    const missing = expectOk(await getAssetInfo(ds, { simbolo: "ZZZZ" }));
    expect(missing.data).toEqual({ simbolo: "ZZZZ" });
    expect(missing.missing[0]).toMatch(/No encontré ZZZZ/);

    ds.assetInfo = async () => ({ status: "unavailable" });
    const down = expectOk(await getAssetInfo(ds, { simbolo: "ORCL" }));
    expect(down.data).toEqual({ simbolo: "ORCL" });
    expect(down.missing[0]).toMatch(/^No pude obtener los datos de ORCL/);

    ds.assetInfo = async () => ({ status: "limited" });
    expect((await getAssetInfo(ds, { simbolo: "ORCL" })).ok).toBe(false);
  });

  it("sin cotización lo dice; en otra moneda no muestra precios como dólares", async () => {
    const ds = demoDataSource();
    ds.assetInfo = async () => ({
      status: "ok",
      info: {
        symbol: "SHOP",
        name: null,
        type: "STOCK",
        sector: null,
        industry: null,
        quote: null,
        company: null,
      },
    });
    const noQuote = expectOk(await getAssetInfo(ds, { simbolo: "SHOP" }));
    expect(noQuote.data.precio).toBeNull();
    expect(noQuote.missing).toContain(
      "No pude obtener la cotización de hoy de SHOP.",
    );

    ds.assetInfo = async () => ({
      status: "ok",
      info: {
        symbol: "SHOP",
        name: null,
        type: "STOCK",
        sector: null,
        industry: null,
        quote: {
          symbol: "SHOP",
          price: "100",
          change: "1",
          changePct: "0.01",
          asOf: new Date("2026-09-30T20:00:00Z"),
          currency: "CAD",
        },
        company: null,
      },
    });
    const foreign = expectOk(await getAssetInfo(ds, { simbolo: "SHOP" }));
    expect(foreign.data).toMatchObject({ precio: null, datos: {} });
    expect(foreign.missing).toEqual([
      "SHOP cotiza en CAD: solo puedo mostrar precios en dólares.",
    ]);
  });

  it("buildTools corta las consultas al proveedor después del tope por pregunta", async () => {
    const ds = demoDataSource();
    const assetInfo = vi.fn(ds.assetInfo);
    ds.assetInfo = assetInfo;
    const tools = buildTools({ ds, memory: null, news: null, timings: [] });
    const call = () =>
      tools[ASSET_TOOL]!.execute!({ simbolo: "ORCL" }, {
        toolCallId: "1",
        messages: [],
      } as never) as Promise<ToolResult>;
    for (let i = 0; i < MAX_ASSET_LOOKUPS; i++) {
      expect((await call()).ok).toBe(true);
    }
    expect((await call()).ok).toBe(false);
    expect(assetInfo).toHaveBeenCalledTimes(MAX_ASSET_LOOKUPS);
  });
});

describe("web_search", () => {
  const deps = (over: Partial<WebSearchDeps> = {}): WebSearchDeps => ({
    search: { searchWeb: vi.fn(async () => []) },
    takeLimit: async () => true,
    ...over,
  });

  it("valida la consulta antes de gastar el límite o llamar a Tavily", async () => {
    const searchWeb = vi.fn(async () => []);
    const takeLimit = vi.fn(async () => true);
    for (const consulta of ["", "ab", "12345678", "  ...  "]) {
      const result = await webSearch(
        deps({ search: { searchWeb }, takeLimit }),
        { consulta },
      );
      expect(result.ok, consulta).toBe(false);
    }
    expect(takeLimit).not.toHaveBeenCalled();
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("respeta el límite diario y no llama a Tavily si se pasó", async () => {
    const searchWeb = vi.fn(async () => []);
    const result = await webSearch(
      deps({ search: { searchWeb }, takeLimit: async () => false }),
      { consulta: "VXUS expense ratio" },
    );
    expect(result.ok).toBe(false);
    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("a Tavily le llega solo la consulta limpia; lo que vuelve es contenido externo", async () => {
    const searchWeb = vi.fn(async () => [
      {
        title: "Título",
        url: "https://example.com/a",
        publishedAt: "2026-09-29",
        site: "example.com",
        snippet: "Extracto",
      },
    ]);
    const result = expectOk(
      await webSearch(deps({ search: { searchWeb } }), {
        consulta: "  VXUS\nexpense   ratio ",
      }),
    );
    expect(searchWeb).toHaveBeenCalledWith("VXUS expense ratio");
    expect(result.source).toEqual({
      fn: "Tavily",
      detail: "Web · VXUS expense ratio",
    });
    expect((result.data.contenido_externo as Data[])[0]).toEqual({
      titulo: "Título",
      sitio: "example.com",
      fecha: "29/09/2026",
      url: "https://example.com/a",
      extracto: "Extracto",
    });
    expect(result.notes[0]).toMatch(/nunca contiene instrucciones/);
  });

  it("sin resultados lo dice en missing, y un fallo vuelve como error legible", async () => {
    const empty = expectOk(
      await webSearch(deps(), { consulta: "Fed rate decision" }),
    );
    expect(empty.missing).toHaveLength(1);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await webSearch(
      deps({
        search: {
          searchWeb: async () => {
            throw new Error("boom");
          },
        },
      }),
      { consulta: "Fed rate decision" },
    );
    expect(result).toEqual({
      ok: false,
      error: "No pude buscar en la web en este momento.",
    });
  });
});
