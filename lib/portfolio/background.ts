import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/db/admin";
import { describeError, getMarketDataProvider } from "@/lib/market-data";
import { createSupabaseMarketStore, runMarketJob } from "@/lib/market-jobs";

/**
 * Después de responder, descarga el historial y la cotización de los instrumentos que todavía no
 * los tienen (una posición recién cargada). No bloquea la respuesta: si el proveedor falla, la
 * posición queda "sin precio" y el cron diario o el próximo "Actualizar precios" lo completan.
 * Si no hay nada pendiente, casi no hace nada. Usa la clave secreta: es trabajo del sistema, no
 * lecturas ni escrituras de la persona.
 */
export function backfillPendingInBackground(label: string): void {
  after(async () => {
    try {
      await runMarketJob({
        job: "backfill",
        provider: await getMarketDataProvider(),
        store: createSupabaseMarketStore(createAdminClient()),
        now: new Date(),
      });
    } catch (error) {
      console.error(`[${label}]`, describeError(error));
    }
  });
}
