import { handleCronRequest } from "@/lib/cron/handler";

export const maxDuration = 300;

/**
 * Descarga solo el historial pendiente (instrumentos nuevos). No está programado: el cron diario
 * ya lo hace, y Hobby permite un solo horario por cron. Se llama a mano con el bearer si hace falta.
 */
export async function GET(request: Request) {
  return handleCronRequest(request, "backfill");
}
