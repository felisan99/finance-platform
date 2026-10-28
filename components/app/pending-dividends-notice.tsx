import Link from "next/link";
import { Notice } from "@/components/app/stat";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { loadPendingDividends } from "@/lib/portfolio/dividends-data";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";

/**
 * Aviso de Inicio cuando hay dividendos detectados sin cargar. Va en su propio `<Suspense>`: si la
 * consulta tarda o falla, Inicio no espera ni se rompe (sin aviso).
 */
export async function PendingDividendsNotice({
  snapshot,
}: {
  snapshot: PortfolioSnapshot;
}) {
  let count = 0;
  try {
    const supabase = await createClient();
    count = (await loadPendingDividends(supabase, snapshot, new Date())).items
      .length;
  } catch (error) {
    console.error("[pending-dividends]", describeError(error));
    return null;
  }
  if (count === 0) return null;
  return (
    <Notice>
      {count === 1
        ? "Hay 1 dividendo detectado que no está en tus operaciones. "
        : `Hay ${count} dividendos detectados que no están en tus operaciones. `}
      <Link href="/activity/dividends" className="underline">
        Revisar
      </Link>
    </Notice>
  );
}
