import { createAdminClient } from "@/lib/db/admin";
import { describeError } from "@/lib/market-data";
import { loadWidget } from "@/lib/widget/data";
import { hashWidgetToken, readBearerToken } from "@/lib/widget/token";

/**
 * Resumen del portafolio para el widget de iPhone (Scriptable, docs/widget-iphone.md). Público para
 * el proxy y sin sesión: lo protege el código personal de `Authorization: Bearer` (nunca en la URL:
 * las URL quedan en los registros). Antes de calcular, pide a Yahoo las cotizaciones de sus
 * posiciones que tengan 2 horas o más (`lib/widget/quotes.ts`: una llamada, con tope de tiempo) y
 * devuelve textos ya formateados. Los errores son genéricos; el script los traduce a un mensaje.
 */
export async function GET(request: Request) {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) return unauthorized();

  try {
    // La clave secreta no lee tablas de usuario: lo de la persona llega solo por `widget_ledger`,
    // que fija de quién son los datos por el token. Lo demás es de mercado (y las cotizaciones).
    const outcome = await loadWidget(
      createAdminClient(),
      hashWidgetToken(token),
      new Date(),
    );
    switch (outcome.kind) {
      case "ok":
        return json(outcome.view, 200);
      case "unknown":
        return unauthorized();
      case "limited":
        return json({ error: "rate_limited" }, 429, { "Retry-After": "600" });
    }
  } catch (error) {
    console.error("[widget]", describeError(error));
    return json({ error: "error" }, 500);
  }
}

const unauthorized = () =>
  json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });

function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
