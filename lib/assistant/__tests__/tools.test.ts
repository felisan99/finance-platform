import { describe, expect, it, vi } from "vitest";
import { addDays, summarizeRealized, realizedEvents } from "@/lib/engine";
import { formatMoney, formatPercent } from "@/lib/portfolio/format";
import { demoDataSource } from "../fixture/demo-data-source";
import { DEMO_NOW } from "../fixture/demo-portfolio";
import type { MemoryItem, MemoryStore } from "../memory";
import type { ToolResult } from "../tool-result";
import { explainMove } from "../tools/explain-move";
import { getGains } from "../tools/gains";
import { buildTools, MEMORY_TOOL, NEWS_TOOL } from "../tools";
import { updateMemory } from "../tools/memory";
import { searchNews, type NewsDeps } from "../tools/news";
import { getPerformance } from "../tools/performance";
import { getPositions } from "../tools/positions";
import { getPriceHistory } from "../tools/price-history";
import { getRisk } from "../tools/risk";
import { checkRange, checkSymbol } from "../tools/shared";
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
      "get_gains",
      "get_performance",
      "get_positions",
      "get_price_history",
      "get_risk",
      "what_if",
    ]);
    expect(tools[MEMORY_TOOL]).toBeUndefined();
    expect(tools[NEWS_TOOL]).toBeUndefined();
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
