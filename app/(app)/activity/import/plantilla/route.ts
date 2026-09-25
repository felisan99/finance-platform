import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { TEMPLATE_FILENAME, buildImportTemplate } from "@/lib/importers";

/**
 * Plantilla del formato simple para bajar y completar. No lleva datos de nadie, pero se sirve solo con
 * sesión como el resto de las descargas (el proxy no es una barrera de autorización) y sin caché.
 */
export async function GET() {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) {
    return new Response("No autorizado", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(buildImportTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${TEMPLATE_FILENAME}"`,
      "Cache-Control": "no-store",
    },
  });
}
