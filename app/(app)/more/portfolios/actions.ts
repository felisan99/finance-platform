"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/db/auth";
import { createClient } from "@/lib/db/server";
import { describeError } from "@/lib/market-data";
import { backfillPendingInBackground } from "@/lib/portfolio/background";
import { rememberPortfolio } from "@/lib/portfolio/current-portfolio";
import { resolveInstrumentId } from "@/lib/portfolio/instruments";
import { ALL_PORTFOLIOS } from "@/lib/portfolio/portfolio-scope";
import { listPortfolios } from "@/lib/portfolio/queries";
import {
  MAX_PORTFOLIOS,
  benchmarkSchema,
  portfolioNameSchema,
  sameName,
} from "@/lib/validation/portfolio";

export type PortfolioFormState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      /** Lo que escribió la persona, para no perderlo. */
      value?: string;
    };

const GENERIC = "No pudimos guardar los cambios. Probá de nuevo en un momento.";
const limitMessage = `Podés tener hasta ${MAX_PORTFOLIOS} portafolios. Borrá alguno para crear otro.`;
const takenMessage = (name: string) =>
  `Ya tenés un portafolio llamado «${name}».`;

const uuid = z.uuid();
const text = (value: FormDataEntryValue | null) =>
  typeof value === "string" ? value : "";

/**
 * Errores de la base que tienen un mensaje propio: el nombre repetido (índice único), el tope de
 * portafolios y el último portafolio (triggers de la migración `multiple_portfolios`).
 */
function knownDbError(code: string | undefined, name: string): string | null {
  if (code === "23505") return takenMessage(name);
  if (code === "MP001") return limitMessage;
  if (code === "MP002") return "No podés borrar tu único portafolio.";
  return null;
}

/**
 * Cambia lo que se está mirando (el selector de Inicio, Posiciones y Actividad): un portafolio o
 * «Todo junto».
 */
export async function selectPortfolio(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) redirect("/login");

  const chosen = formData.get("portfolio");
  const all = chosen === ALL_PORTFOLIOS;
  const id = uuid.safeParse(chosen);
  if (!all && !id.success) return;
  try {
    // Solo se recuerda uno propio (RLS no deja ver los ajenos), o «Todo junto» si hay más de uno.
    const portfolios = await listPortfolios(supabase);
    if (all ? portfolios.length < 2 : !portfolios.some((p) => p.id === id.data))
      return;
    await rememberPortfolio(all ? ALL_PORTFOLIOS : id.data!);
  } catch (error) {
    console.error("[portfolio-select]", describeError(error));
    return;
  }
  revalidatePath("/", "layout");
}

/** Crea un portafolio (con su cuenta) y pasa a mirarlo. */
export async function createPortfolio(
  _previous: PortfolioFormState,
  formData: FormData,
): Promise<PortfolioFormState> {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) redirect("/login");

  const raw = text(formData.get("name"));
  const parsed = portfolioNameSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revisá el nombre.",
      value: raw,
    };
  }
  const name = parsed.data;
  const benchmark = benchmarkSchema.safeParse(
    formData.get("benchmark") ?? "SPY",
  );
  if (!benchmark.success) {
    return {
      status: "error",
      message: "Elegí contra qué comparar.",
      value: raw,
    };
  }

  let id: string;
  try {
    // El tope y los nombres también los controla la base; acá se da el mensaje sin intentar.
    const portfolios = await listPortfolios(supabase);
    if (portfolios.length >= MAX_PORTFOLIOS) {
      return { status: "error", message: limitMessage, value: raw };
    }
    if (portfolios.some((portfolio) => sameName(portfolio.name, name))) {
      return { status: "error", message: takenMessage(name), value: raw };
    }

    // El benchmark tiene que existir como instrumento para tener precios.
    const instrument = await resolveInstrumentId(supabase, benchmark.data);
    if (!instrument.ok) {
      return { status: "error", message: instrument.message, value: raw };
    }

    const { data, error } = await supabase.rpc("create_portfolio", {
      p_name: name,
      p_benchmark: benchmark.data,
    });
    if (error) {
      const known = knownDbError(error.code, name);
      if (known) return { status: "error", message: known, value: raw };
      console.error("[portfolio-create]", error.code, error.message);
      return { status: "error", message: GENERIC, value: raw };
    }
    id = data;
  } catch (error) {
    console.error("[portfolio-create]", describeError(error));
    return { status: "error", message: GENERIC, value: raw };
  }

  await rememberPortfolio(id);
  // Si el benchmark es nuevo en la base, su historial se descarga sin hacer esperar.
  backfillPendingInBackground("benchmark-backfill");
  revalidatePath("/", "layout");
  redirect("/");
}

/** Cambia contra qué se compara el rendimiento de un portafolio propio. */
export async function setPortfolioBenchmark(
  _previous: PortfolioFormState,
  formData: FormData,
): Promise<PortfolioFormState> {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) redirect("/login");

  const id = uuid.safeParse(formData.get("id"));
  const benchmark = benchmarkSchema.safeParse(formData.get("benchmark"));
  if (!id.success) {
    return { status: "error", message: "El portafolio no es válido." };
  }
  if (!benchmark.success) {
    return { status: "error", message: "Elegí contra qué comparar." };
  }

  try {
    const portfolios = await listPortfolios(supabase);
    if (!portfolios.some((portfolio) => portfolio.id === id.data)) {
      return { status: "error", message: "No encontramos ese portafolio." };
    }
    const instrument = await resolveInstrumentId(supabase, benchmark.data);
    if (!instrument.ok) return { status: "error", message: instrument.message };

    const { error } = await supabase
      .from("portfolios")
      .update({ benchmark_symbol: benchmark.data })
      .eq("id", id.data);
    if (error) {
      console.error("[portfolio-benchmark]", error.code, error.message);
      return { status: "error", message: GENERIC };
    }
  } catch (error) {
    console.error("[portfolio-benchmark]", describeError(error));
    return { status: "error", message: GENERIC };
  }

  backfillPendingInBackground("benchmark-backfill");
  revalidatePath("/", "layout");
  redirect("/more/portfolios");
}

/** Cambia el nombre de un portafolio propio. */
export async function renamePortfolio(
  _previous: PortfolioFormState,
  formData: FormData,
): Promise<PortfolioFormState> {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) redirect("/login");

  const raw = text(formData.get("name"));
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) {
    return { status: "error", message: "El portafolio no es válido." };
  }
  const parsed = portfolioNameSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Revisá el nombre.",
      value: raw,
    };
  }
  const name = parsed.data;

  try {
    const portfolios = await listPortfolios(supabase);
    if (!portfolios.some((portfolio) => portfolio.id === id.data)) {
      return { status: "error", message: "No encontramos ese portafolio." };
    }
    if (
      portfolios.some(
        (portfolio) =>
          portfolio.id !== id.data && sameName(portfolio.name, name),
      )
    ) {
      return { status: "error", message: takenMessage(name), value: raw };
    }

    const { error } = await supabase
      .from("portfolios")
      .update({ name })
      .eq("id", id.data);
    if (error) {
      const known = knownDbError(error.code, name);
      if (known) return { status: "error", message: known, value: raw };
      console.error("[portfolio-rename]", error.code, error.message);
      return { status: "error", message: GENERIC, value: raw };
    }
  } catch (error) {
    console.error("[portfolio-rename]", describeError(error));
    return { status: "error", message: GENERIC, value: raw };
  }

  revalidatePath("/", "layout");
  redirect("/more/portfolios");
}

/**
 * Borra un portafolio con todas sus operaciones. Para confirmar hay que escribir su nombre: no se
 * puede deshacer. El último no se puede borrar (también lo impide la base).
 */
export async function deletePortfolio(
  _previous: PortfolioFormState,
  formData: FormData,
): Promise<PortfolioFormState> {
  const supabase = await createClient();
  if (!(await getSessionUser(supabase))) redirect("/login");

  const raw = text(formData.get("confirm"));
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) {
    return { status: "error", message: "El portafolio no es válido." };
  }

  try {
    const portfolios = await listPortfolios(supabase);
    const target = portfolios.find((portfolio) => portfolio.id === id.data);
    if (!target) {
      return { status: "error", message: "No encontramos ese portafolio." };
    }
    if (portfolios.length <= 1) {
      return {
        status: "error",
        message: "No podés borrar tu único portafolio.",
      };
    }
    if (!sameName(raw.replace(/\s+/g, " ").trim(), target.name)) {
      return {
        status: "error",
        message: `Para confirmar, escribí «${target.name}».`,
        value: raw,
      };
    }

    const { error } = await supabase
      .from("portfolios")
      .delete()
      .eq("id", id.data);
    if (error) {
      const known = knownDbError(error.code, target.name);
      if (known) return { status: "error", message: known, value: raw };
      console.error("[portfolio-delete]", error.code, error.message);
      return { status: "error", message: GENERIC, value: raw };
    }
  } catch (error) {
    console.error("[portfolio-delete]", describeError(error));
    return { status: "error", message: GENERIC, value: raw };
  }

  // Si era el que se miraba, la cookie ya no coincide con ninguno y se pasa al primero.
  revalidatePath("/", "layout");
  redirect("/more/portfolios");
}
