import { TrendCard } from "@/components/app/trend-card";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import { loadPositionTrends } from "@/lib/portfolio/trend-data";
import type { TrendRowView } from "@/lib/portfolio/trend-view";

/**
 * "Tus posiciones" con minigráficos. Va en su propio `<Suspense>` porque lee cierres; si falla
 * o no hay posiciones abiertas con precio, no muestra nada (el resto de Inicio ya lo cuenta todo).
 */
export async function TrendSection({
  snapshot,
  now,
}: {
  snapshot: PortfolioSnapshot;
  now: Date;
}) {
  let rows: TrendRowView[];
  try {
    rows = await loadPositionTrends(await createClient(), snapshot, now);
  } catch (error) {
    console.error("[trends]", describeError(error));
    return null;
  }
  return rows.length === 0 ? null : <TrendCard rows={rows} />;
}
