import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/db/proxy";

// En Next 16 el antiguo `middleware` se llama `proxy`.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Todo menos estáticos, imágenes optimizadas y archivos con extensión de asset.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
