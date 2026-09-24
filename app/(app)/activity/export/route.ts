import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { buildTransactionsCsv } from "@/lib/portfolio/csv-export";
import {
  getInstruments,
  getPrimaryAccount,
  getTransactionRows,
} from "@/lib/portfolio/queries";
import { localDateKey } from "@/lib/portfolio/time";

/**
 * Backup de todas las transacciones en CSV (spec §10.3). Exige sesión (el proxy no alcanza: se
 * verifica acá) y no se cachea. Las celdas de texto llevan defensa contra inyección de fórmulas.
 */
export async function GET() {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) {
    return new Response("No autorizado", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const account = await getPrimaryAccount(supabase);
  const rows = account ? await getTransactionRows(supabase, account.id) : [];
  const instruments = await getInstruments(supabase, [
    ...new Set(rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : []))),
  ]);
  const csv = buildTransactionsCsv(
    rows,
    new Map(instruments.map((i) => [i.id, i.symbol])),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transacciones-${localDateKey(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
