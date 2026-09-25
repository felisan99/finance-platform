import { z } from "zod";

/** Formulario de ingreso. El email se normaliza igual que en public.allowed_emails (minúsculas, sin espacios). */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Largo del código de ingreso: tiene que coincidir con `otp_length` de supabase/config.toml. */
export const CODE_LENGTH = 6;

/**
 * El código del correo: seis dígitos. Se aceptan espacios y saltos de más (algunos correos lo
 * muestran como "123 456", y al pegar se cuelan). Cualquier otra cosa se rechaza.
 */
export const codeSchema = z
  .string()
  .max(32)
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(new RegExp(`^\\d{${CODE_LENGTH}}$`)));

/** Segundo paso: el email del primero y el código. */
export const verifyCodeSchema = z.object({
  email: loginSchema.shape.email,
  token: codeSchema,
});

export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;
