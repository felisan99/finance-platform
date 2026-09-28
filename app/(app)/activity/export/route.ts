import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { buildTransactionsCsv } from "@/lib/portfolio/csv-export";
import { getPortfolioContext } from "@/lib/portfolio/current-portfolio";
import {
  fileSlug,
  portfoliosOfScope,
  scopeName,
} from "@/lib/portfolio/portfolio-scope";
import { getInstruments, getTransactionRows } from "@/lib/portfolio/queries";
import { localDateKey } from "@/lib/portfolio/time";

/**
 * Backup en CSV de lo que se está mirando (spec §10.3): un portafolio o, con «Todo junto», todos en
 * un solo archivo con la columna `portafolio` al final. Exige sesión (el proxy no alcanza: se
 * verifica acá) y no se cachea. Las celdas de texto llevan defensa contra inyección de fórmulas.
 * Con varios portafolios, el nombre del archivo dice de cuál es. Se vuelve a importar igual,
 * eligiendo el portafolio (la columna extra no se lee).
 */
export async function GET() {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) {
    return new Response("No autorizado", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { portfolios, scope } = await getPortfolioContext(supabase);
  const scoped = scope ? portfoliosOfScope(scope) : [];
  const perPortfolio = await Promise.all(
    scoped.map(async (portfolio) => ({
      portfolio,
      rows: await getTransactionRows(supabase, portfolio.account.id),
    })),
  );
  // Con «Todo junto», un solo archivo en orden cronológico con la columna `portafolio`.
  const rows = perPortfolio
    .flatMap(({ rows }) => rows)
    .sort(
      (a, b) =>
        Date.parse(a.executed_at) - Date.parse(b.executed_at) ||
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        a.seq - b.seq,
    );
  const nameById = new Map(
    perPortfolio.flatMap(({ portfolio, rows }) =>
      rows.map((row) => [row.id, portfolio.name] as const),
    ),
  );
  const instruments = await getInstruments(supabase, [
    ...new Set(rows.flatMap((r) => (r.instrument_id ? [r.instrument_id] : []))),
  ]);
  const csv = buildTransactionsCsv(
    rows,
    new Map(instruments.map((i) => [i.id, i.symbol])),
    scope?.kind === "all" ? (row) => nameById.get(row.id) ?? "" : undefined,
  );
  const name =
    scope && portfolios.length > 1
      ? `transacciones-${fileSlug(scopeName(scope))}`
      : "transacciones";

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${localDateKey(new Date())}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
