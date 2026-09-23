import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db/server";

/**
 * Destino del enlace de acceso del correo (flujo PKCE): Supabase verifica el token y vuelve
 * acá con `?code=`, que se canjea por la sesión. El canje necesita la cookie con el
 * "code verifier" que se guardó al pedir el enlace, por eso el enlace tiene que abrirse en el
 * mismo navegador donde se pidió.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");

  const target = url.clone();
  target.search = "";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      target.pathname = "/";
      return NextResponse.redirect(target);
    }
  }

  target.pathname = "/login";
  target.searchParams.set("error", "link");
  return NextResponse.redirect(target);
}
