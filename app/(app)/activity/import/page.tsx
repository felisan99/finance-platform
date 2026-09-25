import { ImportForm } from "@/components/app/import-form";
import {
  ImportHistory,
  type ImportHistoryItem,
} from "@/components/app/import-history";
import { ImportGuide } from "@/components/app/import-guide";
import { PageHeader } from "@/components/app/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { formatDateTime } from "@/lib/portfolio/format";
import { getRecentImports } from "@/lib/portfolio/queries";
import { cleanText } from "@/lib/market-data/sanitize";

const SOURCE_LABELS: Record<string, string> = {
  delta_csv: "Delta",
  csv: "Portfolio Tracker",
};

/**
 * Las últimas importaciones, ya escritas para mostrar. Si falla la lectura, la pantalla sigue sin el
 * historial. El cliente se crea afuera del `try`: leer las cookies es lo que le avisa a Next que la
 * página es dinámica, y un `catch` no debe tragarse ese aviso.
 */
async function loadHistory(): Promise<ImportHistoryItem[]> {
  const supabase = await createClient();
  try {
    const rows = await getRecentImports(supabase);
    return rows.map((row) => ({
      id: row.import_id,
      filename: cleanText(row.filename, 80) ?? "Sin nombre",
      formatLabel: SOURCE_LABELS[row.source] ?? row.source,
      when: formatDateTime(new Date(row.created_at)),
      liveCount: row.live_count,
      status:
        row.undone_at !== null
          ? "undone"
          : row.live_count === 0
            ? "empty"
            : "active",
      undoneWhen:
        row.undone_at !== null ? formatDateTime(new Date(row.undone_at)) : null,
    }));
  } catch (error) {
    console.error("[import-history]", describeError(error));
    return [];
  }
}

export default async function ImportPage() {
  const history = await loadHistory();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Importar operaciones"
        subtitle="Desde un CSV o una planilla"
      />
      <ImportGuide />
      <ImportForm />
      {history.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Importaciones anteriores</CardTitle>
          </CardHeader>
          <CardContent>
            <ImportHistory items={history} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
