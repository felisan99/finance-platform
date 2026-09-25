"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { clearLoginAttempts, takeLoginAttempt } from "@/lib/db/login-attempts";
import { describeError } from "@/lib/market-data";
import { loginSchema, verifyCodeSchema } from "@/lib/validation/login";

/** Primer paso: pedir el código. `email` es el normalizado, para mostrarlo y usarlo en el segundo paso. */
export type RequestCodeState =
  | { status: "idle" }
  | { status: "code"; email: string }
  | { status: "error"; message: string };

/** Segundo paso: verificar el código (si sale bien, redirige y no devuelve nada). */
export type VerifyCodeState =
  { status: "idle" } | { status: "error"; message: string };

export async function requestCode(
  _previous: RequestCodeState,
  formData: FormData,
): Promise<RequestCodeState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: "Escribí un email válido." };
  }
  const { email } = parsed.data;

  const supabase = await createClient();
  // Sin `emailRedirectTo`: el correo lleva un código, no un enlace (que abriría el navegador y no la
  // app instalada, cuyas cookies son aparte en el iPhone).
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });

  if (!error) return { status: "code", email };

  // El hook de registro rechaza (403) a los emails que no están en allowed_emails. Se responde
  // igual que si se hubiera enviado, para no revelar quién tiene acceso.
  if (error.status === 403) return { status: "code", email };

  if (error.status === 429) {
    return {
      status: "error",
      message:
        "Pediste varios códigos seguidos. Esperá un par de minutos y probá de nuevo.",
    };
  }
  console.error("[login-request]", error.status, error.code);
  return {
    status: "error",
    message: "No pudimos enviar el código. Probá de nuevo en un momento.",
  };
}

export async function verifyCode(
  _previous: VerifyCodeState,
  formData: FormData,
): Promise<VerifyCodeState> {
  const parsed = verifyCodeSchema.safeParse({
    email: formData.get("email"),
    token: formData.get("token"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Escribí los 6 dígitos del código." };
  }
  const { email, token } = parsed.data;

  // Seis dígitos son un millón de combinaciones: se limitan los intentos por email antes de probar.
  try {
    if (!(await takeLoginAttempt(email))) {
      return {
        status: "error",
        message:
          "Demasiados intentos. Esperá unos minutos y pedí un código nuevo.",
      };
    }
  } catch (error) {
    console.error("[login-verify]", describeError(error));
    return {
      status: "error",
      message: "No pudimos verificar el código. Probá de nuevo en un momento.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) {
    if (error.status === 429) {
      return {
        status: "error",
        message: "Demasiados intentos. Esperá unos minutos y probá de nuevo.",
      };
    }
    // Código equivocado, vencido o ya usado: no se distingue (ni si el email tiene acceso).
    return {
      status: "error",
      message: "El código no es válido o venció. Revisalo o pedí uno nuevo.",
    };
  }

  // La sesión ya está en las cookies. Borrar el contador es un extra: si falla no se frena el ingreso.
  try {
    await clearLoginAttempts(email);
  } catch (clearError) {
    console.error("[login-verify]", describeError(clearError));
  }
  redirect("/");
}
