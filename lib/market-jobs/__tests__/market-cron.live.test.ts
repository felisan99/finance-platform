import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/daily-prices/route";
import {
  createAdmin,
  createTestUserRecord,
  deleteTestUser,
  type DbClient,
  type TestUserRecord,
} from "@/lib/db/__tests__/integration-helpers";
import { parseDeltaCsv } from "@/lib/importers";
import { addDays, isoDate } from "../dates";

// Criterio de terminado de la Fase 3 (spec §14.2): "después de correr el cron, `prices_daily`
// tiene historial de todos los símbolos del fixture".
//
// Prueba EN VIVO: Yahoo Finance real + finance-dev real (`pnpm test:live`). Usa el importador de
// Delta sobre el CSV del fixture y llama al handler real del cron con su bearer. Un usuario de
// prueba con una compra por símbolo (en su primera fecha real) hace que los 10 instrumentos
// estén "activos". Al terminar se borran el usuario y las corridas; QUEDAN los instrumentos, los
// precios y las cotizaciones reales (datos de mercado compartidos, útiles para la Fase 4).

interface Trade {
  symbol: string;
  type: "BUY" | "SELL";
  executedAt: Date;
  price: number;
}

const csv = readFileSync(
  resolve(process.cwd(), "lib/engine/__fixtures__/delta_export.csv"),
  "utf8",
);
const parsed = parseDeltaCsv(csv);
const trades: Trade[] = parsed.transactions.flatMap((t) =>
  t.type === "BUY" || t.type === "SELL"
    ? [
        {
          symbol: t.symbol,
          type: t.type,
          executedAt: t.executedAt,
          price: t.price.toNumber(),
        },
      ]
    : [],
);
const symbols = parsed.instruments.map((i) => i.symbol);

function must<R extends { data: unknown; error: { message: string } | null }>(
  result: R,
  what: string,
): NonNullable<R["data"]> {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(
      `Preparación: ${what}: ${result.error?.message ?? "sin datos"}`,
    );
  }
  return result.data as NonNullable<R["data"]>;
}

describe("cron diario contra Yahoo real y finance-dev (aceptación de la Fase 3)", () => {
  let admin: DbClient;
  let user: TestUserRecord | undefined;
  const instrumentId = new Map<string, string>();
  const runIds: string[] = [];

  const readPrices = async (id: string) => {
    const rows: Array<{
      date: string;
      close: number;
      adj_close: number | null;
    }> = [];
    for (let offset = 0; ; offset += 1000) {
      const page = must(
        await admin
          .from("prices_daily")
          .select("date, close, adj_close")
          .eq("instrument_id", id)
          .order("date")
          .range(offset, offset + 999),
        "precios",
      );
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  };

  const callCron = async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/daily-prices", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    const body = (await response.json()) as {
      status: string;
      runId: string | null;
      issues: number;
      summary: Record<string, number | string>;
    };
    if (body.runId) runIds.push(body.runId);
    return { http: response.status, body };
  };

  /** Detalle de los errores de una corrida (para que un fallo diga qué pasó). */
  const runErrors = async (runId: string | null) =>
    runId
      ? JSON.stringify(
          (
            await admin
              .from("market_job_runs")
              .select("errors")
              .eq("id", runId)
              .single()
          ).data?.errors,
        )
      : "sin registro de corrida";

  beforeAll(async () => {
    admin = createAdmin();
    expect(symbols).toHaveLength(10);
    expect(trades.length).toBeGreaterThan(10);

    // Instrumentos reales del fixture: se reutilizan si existen y se dejan "sin historial" para
    // que la corrida haga un backfill completo (los precios los regenera el cron).
    for (const info of parsed.instruments) {
      const existing = await admin
        .from("instruments")
        .select("id")
        .eq("symbol", info.symbol)
        .maybeSingle();
      const id =
        existing.data?.id ??
        must(
          await admin
            .from("instruments")
            .insert({ symbol: info.symbol, name: info.name, type: info.type })
            .select("id")
            .single(),
          `instrumento ${info.symbol}`,
        ).id;
      instrumentId.set(info.symbol, id);
      await admin.from("prices_daily").delete().eq("instrument_id", id);
      await admin.from("quotes_latest").delete().eq("instrument_id", id);
      await admin.from("corporate_actions").delete().eq("instrument_id", id);
      await admin
        .from("instruments")
        .update({ history_backfilled_at: null, history_from: null })
        .eq("id", id);
    }

    // Una compra por símbolo, en su primera fecha real: es lo que hace "activo" al instrumento.
    user = await createTestUserRecord(admin, "live");
    const accountId = must(
      await admin.from("accounts").select("id").eq("user_id", user.id).single(),
      "cuenta",
    ).id;
    for (const symbol of symbols) {
      const first = trades
        .filter((t) => t.symbol === symbol)
        .sort((a, b) => +a.executedAt - +b.executedAt)[0];
      if (!first)
        throw new Error(`el fixture no tiene operaciones de ${symbol}`);
      must(
        await admin
          .from("transactions")
          .insert({
            user_id: user.id,
            account_id: accountId,
            type: "BUY",
            instrument_id: instrumentId.get(symbol),
            executed_at: first.executedAt.toISOString(),
            quantity: 1,
            price: first.price,
            fee: 0,
          })
          .select("id")
          .single(),
        `compra de ${symbol}`,
      );
    }
  });

  afterAll(async () => {
    // El usuario se lleva sus transacciones; los datos de mercado quedan a propósito.
    await deleteTestUser(admin, user);
    if (runIds.length > 0)
      await admin.from("market_job_runs").delete().in("id", runIds);
  });

  it("sin el bearer el endpoint responde 401 y no toca nada", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/daily-prices"),
    );
    expect(response.status).toBe(401);
  });

  it("después de correr el cron, prices_daily tiene el historial de todos los símbolos del fixture", async () => {
    const first = await callCron();
    expect(first.http, await runErrors(first.body.runId)).toBe(200);
    expect(first.body.status, await runErrors(first.body.runId)).toBe("ok");
    expect(first.body.summary).toMatchObject({
      backfilled: expect.any(Number),
      failed: 0,
    });
    expect(Number(first.body.summary.backfilled)).toBeGreaterThanOrEqual(10);

    const today = isoDate(new Date());
    for (const symbol of symbols) {
      const id = instrumentId.get(symbol) as string;
      const firstTrade = trades
        .filter((t) => t.symbol === symbol)
        .map((t) => isoDate(t.executedAt))
        .sort()[0] as string;
      const start = addDays(firstTrade, -7);
      const rows = await readPrices(id);
      const label = `${symbol}: ${rows.length} filas`;

      // Historial desde la primera compra (con margen) hasta la última rueda cerrada.
      expect(rows.length, label).toBeGreaterThan(20);
      expect(
        rows[0]?.date && rows[0].date >= start,
        `${label}, primera ${rows[0]?.date} < ${start}`,
      ).toBe(true);
      expect(
        rows[0]?.date && rows[0].date <= firstTrade,
        `${label}, primera ${rows[0]?.date} > compra ${firstTrade}`,
      ).toBe(true);
      expect(
        rows.at(-1)?.date && rows.at(-1)!.date >= addDays(today, -5),
        `${label}, última ${rows.at(-1)?.date}`,
      ).toBe(true);

      // Fechas hábiles, únicas y crecientes; cierres positivos; sin huecos de más de una semana.
      const dates = rows.map((r) => r.date);
      expect(new Set(dates).size, `${label}: fechas repetidas`).toBe(
        dates.length,
      );
      expect([...dates].sort(), `${label}: desordenadas`).toEqual(dates);
      for (const date of dates) {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        expect([0, 6], `${symbol} ${date} cae en fin de semana`).not.toContain(
          weekday,
        );
      }
      expect(
        rows.every((r) => r.close > 0),
        `${label}: cierre no positivo`,
      ).toBe(true);
      for (let i = 1; i < dates.length; i++) {
        const gap =
          (Date.parse(dates[i] as string) -
            Date.parse(dates[i - 1] as string)) /
          86_400_000;
        expect(
          gap,
          `${symbol}: hueco de ${gap} días antes de ${dates[i]}`,
        ).toBeLessThanOrEqual(6);
      }

      // El instrumento quedó marcado como descargado desde el inicio pedido.
      const meta = must(
        await admin
          .from("instruments")
          .select("history_backfilled_at, history_from")
          .eq("id", id)
          .single(),
        "instrumento",
      );
      expect(meta.history_from, symbol).toBe(start);
      expect(meta.history_backfilled_at, symbol).not.toBeNull();

      // Cotización vigente.
      const quote = must(
        await admin
          .from("quotes_latest")
          .select("price, as_of")
          .eq("instrument_id", id)
          .single(),
        `cotización de ${symbol}`,
      );
      expect(quote.price, symbol).toBeGreaterThan(0);
      expect(
        Date.now() - Date.parse(quote.as_of),
        `${symbol}: cotización vieja`,
      ).toBeLessThan(10 * 86_400_000);
    }

    // La corrida quedó registrada, cerrada y con lo que hizo.
    const run = must(
      await admin
        .from("market_job_runs")
        .select("status, finished_at, summary, errors")
        .eq("id", first.body.runId as string)
        .single(),
      "corrida",
    );
    expect(run.status).toBe("ok");
    expect(run.finished_at).not.toBeNull();
    expect(run.summary).toMatchObject({
      job: "daily-prices",
      provider: "yahoo",
    });
  });

  it("los precios de Yahoo son coherentes con los del CSV: cada operación cae cerca del cierre de su día", async () => {
    // Umbral amplio (25 %): el CSV trae el precio de la ejecución y Yahoo el cierre del día. Un
    // desvío mayor indicaría símbolos cruzados, escala equivocada (p. ej. un split) o fechas corridas.
    const closes = new Map<string, Array<{ date: string; close: number }>>();
    for (const symbol of symbols) {
      closes.set(
        symbol,
        (await readPrices(instrumentId.get(symbol) as string)).map((r) => ({
          date: r.date,
          close: r.close,
        })),
      );
    }
    const worst: string[] = [];
    for (const trade of trades) {
      const day = isoDate(trade.executedAt);
      const bars = closes.get(trade.symbol) ?? [];
      const bar = [...bars].reverse().find((b) => b.date <= day);
      expect(
        bar,
        `${trade.symbol} ${day}: sin cierre en o antes de la fecha`,
      ).toBeDefined();
      const deviation =
        Math.abs(trade.price - (bar as { close: number }).close) /
        (bar as { close: number }).close;
      worst.push(
        `${trade.symbol} ${day} ${trade.type} ${trade.price} vs ${(bar as { close: number }).close} (${(deviation * 100).toFixed(1)} %)`,
      );
      expect(
        deviation,
        `${trade.symbol} ${day}: ${worst.at(-1)}`,
      ).toBeLessThanOrEqual(0.25);
    }
  });

  it("una segunda corrida es incremental e idempotente", async () => {
    const before = new Map<
      string,
      Array<{ date: string; close: number; adj_close: number | null }>
    >();
    for (const symbol of symbols)
      before.set(symbol, await readPrices(instrumentId.get(symbol) as string));

    const second = await callCron();

    expect(second.http, await runErrors(second.body.runId)).toBe(200);
    expect(second.body.status, await runErrors(second.body.runId)).toBe("ok");
    expect(second.body.summary).toMatchObject({
      backfilled: 0,
      rebackfilled: 0,
      failed: 0,
    });
    expect(Number(second.body.summary.incremental)).toBeGreaterThanOrEqual(10);

    for (const symbol of symbols) {
      const after = await readPrices(instrumentId.get(symbol) as string);
      const old = before.get(symbol) ?? [];
      const byDate = new Map(after.map((r) => [r.date, r]));
      // Lo ya guardado no cambia (Yahoo puede completar como máximo alguna rueda que estaba en null).
      for (const row of old)
        expect(byDate.get(row.date), `${symbol} ${row.date}`).toEqual(row);
      expect(after.length - old.length, symbol).toBeLessThanOrEqual(2);
    }
  });
});
