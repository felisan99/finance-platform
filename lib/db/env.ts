import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ error: "debe ser una URL" }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({ error: "falta la variable" })
    .min(1, "falta la variable"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * Variables públicas de Supabase (URL y clave publicable). Se leen con accesos estáticos a
 * `process.env.NEXT_PUBLIC_*`: es la única forma en que Next las inlinea en el bundle del cliente.
 */
export function getPublicEnv(): PublicEnv {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Variables de entorno de Supabase inválidas (${detail})`);
  }
  return parsed.data;
}
