import { handleCronRequest } from "@/lib/cron/handler";

// Hobby permite hasta 300 s por función (docs/limits.md); el job corta a los 240 s por su cuenta.
export const maxDuration = 300;

/** Cron diario (spec §7.2): precios, cotizaciones y backfill de lo pendiente. Ver vercel.json. */
export async function GET(request: Request) {
  return handleCronRequest(request, "daily-prices");
}
