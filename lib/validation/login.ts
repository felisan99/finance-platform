import { z } from "zod";

/** Formulario de ingreso. El email se normaliza igual que en public.allowed_emails (minúsculas, sin espacios). */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type LoginInput = z.infer<typeof loginSchema>;
