import { NextResponse, type NextRequest } from "next/server";
import { hasMalformedEncoding } from "@/lib/db/auth-routes";
import { updateSession } from "@/lib/db/proxy";

// En Next 16 el antiguo `middleware` se llama `proxy`.
export async function proxy(request: NextRequest) {
  // Una dirección con `%` mal formado haría fallar al enrutador con un 500: se corta acá con un 400.
  if (hasMalformedEncoding(request.nextUrl.pathname)) {
    return new NextResponse("Bad Request", { status: 400 });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Todo menos estáticos, imágenes optimizadas y archivos con extensión de asset.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
