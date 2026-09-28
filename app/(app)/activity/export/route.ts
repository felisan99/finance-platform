import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { buildTransactionsCsv } from "@/lib/portfolio/csv-export";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import { fileSlug } from "@/lib/portfolio/portfolio-scope";
import { getInstruments, getTransactionRows } from "@/lib/portfolio/queries";
import { localDateKey } from "@/lib/portfolio/time";

/**
 * Backup de las transacciones del portafolio que se está mirando, en CSV (spec §10.3). Exige sesión
 * (el proxy no alcanza: se verifica acá) y no se cachea. Las celdas de texto llevan defensa contra
 * inyección de fórmulas. Con varios portafolios, el nombre del archivo dice de cuál es (el formato
 * del CSV no cambia: se vuelve a importar igual, eligiendo el portafolio).
 */
export async function GET() {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) {
    return new Response("No autorizado", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { portfolios, current } = await getPortfolioContext(supabase);
  const rows = current
    ? await getTransactionRows(supabase, current.account.id)
    : [];
  const name =
    current && portfolios.length > 1
      ? `transacciones-${fileSlug(current.name)}`
      : "transacciones";
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
      "Content-Disposition": `attachment; filename="${name}-${localDateKey(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
