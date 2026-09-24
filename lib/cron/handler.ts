import { createAdminClient } from "@/lib/db/admin";
import {
  describeError,
  getMarketDataProvider,
  type MarketDataProvider,
} from "@/lib/market-data";
import {
  createSupabaseMarketStore,
  runMarketJob,
  type JobName,
  type MarketStore,
} from "@/lib/market-jobs";
import { verifyCronAuthorization } from "./auth";

export interface CronDeps {
  /** Por defecto `process.env.CRON_SECRET`. */
  secret?: string | undefined;
  now?: () => Date;
  getProvider?: () => Promise<MarketDataProvider>;
  /** Por defecto, el store de Supabase con la clave secreta (los crons no pertenecen a un usuario). */
  getStore?: () => MarketStore;
}

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Handler común de `/api/cron/*`. Orden deliberado: primero se autoriza (sin tocar la base ni
 * el proveedor) y recién después se arma nada.
 *
 * La respuesta lleva solo el estado y los contadores; el detalle de los errores queda en
 * `market_job_runs`. Un `error` responde 500 para que los logs de Vercel lo marquen como fallo.
 */
export async function handleCronRequest(
  request: Request,
  job: JobName,
  deps: CronDeps = {},
): Promise<Response> {
  const secret = "secret" in deps ? deps.secret : process.env.CRON_SECRET;
  const auth = verifyCronAuthorization(
    request.headers.get("authorization"),
    secret,
  );

  if (auth === "misconfigured") {
    console.error(
      "[cron] CRON_SECRET ausente o demasiado corto: el endpoint está cerrado",
    );
    return json({ error: "misconfigured" }, 500);
  }
  if (auth === "unauthorized") return json({ error: "unauthorized" }, 401);

  try {
    const provider = await (deps.getProvider ?? getMarketDataProvider)();
    const store = (
      deps.getStore ?? (() => createSupabaseMarketStore(createAdminClient()))
    )();
    const result = await runMarketJob({
      job,
      provider,
      store,
      now: (deps.now ?? (() => new Date()))(),
    });
    return json(
      {
        status: result.status,
        runId: result.runId,
        summary: result.summary,
        issues: result.issues.length,
      },
      result.status === "error" ? 500 : 200,
    );
  } catch (error) {
    // Falla al armar el proveedor o el cliente (variables de entorno, configuración).
    console.error(
      "[cron] no se pudo iniciar el job",
      job,
      describeError(error),
    );
    return json({ error: "internal" }, 500);
  }
}
