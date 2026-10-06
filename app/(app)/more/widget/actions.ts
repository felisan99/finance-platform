"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { ALL_PORTFOLIOS } from "@/lib/portfolio/portfolio-scope";
import { listPortfolios } from "@/lib/portfolio/queries";
import { generateWidgetToken, hashWidgetToken } from "@/lib/widget/token";

export type WidgetFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** El código recién creado: se muestra una sola vez (en la base queda solo su hash). */
  | { status: "created"; token: string };

const GENERIC = "No pudimos guardar los cambios. Probá de nuevo en un momento.";
const portfolioSchema = z.union([z.literal(ALL_PORTFOLIOS), z.uuid()]);

/**
 * Crea el código del widget, o lo reemplaza (el anterior deja de funcionar). Se guarda con la
 * sesión de la persona (`create_widget_token` usa `auth.uid()`), no con la clave secreta.
 */
export async function createWidgetToken(
  _previous: WidgetFormState,
  formData: FormData,
): Promise<WidgetFormState> {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) redirect("/login");

  const chosen = portfolioSchema.safeParse(
    formData.get("portfolio") ?? ALL_PORTFOLIOS,
  );
  if (!chosen.success) {
    return { status: "error", message: "Elegí qué portafolio mostrar." };
  }

  const token = generateWidgetToken();
  try {
    let portfolioId: string | null = null;
    if (chosen.data !== ALL_PORTFOLIOS) {
      // Solo uno propio (RLS no deja ver los ajenos); la base lo vuelve a verificar.
      const portfolios = await listPortfolios(supabase);
      if (!portfolios.some((portfolio) => portfolio.id === chosen.data)) {
        return { status: "error", message: "Elegí qué portafolio mostrar." };
      }
      portfolioId = chosen.data;
    }
    const { error } = await supabase.rpc("create_widget_token", {
      p_token_hash: hashWidgetToken(token),
      // Los tipos generados no admiten `null` en los argumentos (Postgres sí): `null` = todos.
      p_portfolio_id: portfolioId as string,
    });
    if (error) throw new Error(`db create_widget_token: ${error.message}`);
  } catch (error) {
    console.error("[widget-token]", describeError(error));
    return { status: "error", message: GENERIC };
  }
  revalidatePath("/more/widget");
  return { status: "created", token };
}

/** Revoca el código: el widget deja de actualizarse y muestra que hay que crear otro. */
export async function revokeWidgetToken(): Promise<WidgetFormState> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  if (!user) redirect("/login");

  try {
    const { error } = await supabase
      .from("widget_tokens")
      .delete()
      .eq("user_id", user.id);
    if (error) throw new Error(`db widget_tokens: ${error.message}`);
  } catch (error) {
    console.error("[widget-token]", describeError(error));
    return { status: "error", message: GENERIC };
  }
  revalidatePath("/more/widget");
  return { status: "idle" };
}
