"use server";

import { createClient } from "@/lib/db/server";
import { getSiteOrigin } from "@/lib/site";
import { loginSchema } from "@/lib/validation/login";

export type LoginState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string };

export async function requestMagicLink(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: "Escribí un email válido." };
  }

  const supabase = await createClient();
  const origin = await getSiteOrigin();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (!error) return { status: "sent" };

  // El hook de registro rechaza (403) a los emails que no están en allowed_emails. Se responde
  // igual que si se hubiera enviado, para no revelar quién tiene acceso.
  if (error.status === 403) return { status: "sent" };

  if (error.status === 429) {
    return {
      status: "error",
      message:
        "Pediste varios enlaces seguidos. Esperá un minuto y probá de nuevo.",
    };
  }
  return {
    status: "error",
    message: "No pudimos enviar el enlace. Probá de nuevo en un momento.",
  };
}
