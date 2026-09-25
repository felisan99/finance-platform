import type { ResolveResult } from "@/lib/market-jobs/instruments";

// Verificación de los símbolos NUEVOS de un CSV escrito a mano contra el proveedor de datos: un
// error de tipeo (`APPL`) no debe llenar la tabla compartida de instrumentos. Un archivo de Delta
// no pasa por acá (lo genera una máquina). Se verifican de a pocos a la vez y con un tope de
// tiempo por símbolo: un proveedor lento no cuelga la pantalla.

/** Más símbolos nuevos que esto en un solo archivo: se pide importar en partes. */
export const MAX_VERIFIED_SYMBOLS = 40;
const CONCURRENCY = 5;
const TIMEOUT_MS = 8_000;

const UNAVAILABLE: ResolveResult = {
  ok: false,
  reason: "UNAVAILABLE",
  message:
    "No pudimos verificar el símbolo ahora; probá de nuevo en un momento",
};

async function withTimeout(
  work: Promise<ResolveResult>,
  ms: number,
): Promise<ResolveResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ResolveResult>((resolve) => {
    timer = setTimeout(() => resolve(UNAVAILABLE), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `símbolo → resultado` de cada uno de `symbols` (sin repetidos). `resolve` nunca debería lanzar
 * (`resolveNewInstrument` devuelve `UNAVAILABLE`), pero si lo hace se cuenta como no disponible.
 */
export async function verifyNewSymbols(
  resolve: (symbol: string) => Promise<ResolveResult>,
  symbols: readonly string[],
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<Map<string, ResolveResult>> {
  const queue = [...new Set(symbols)];
  const results = new Map<string, ResolveResult>();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const worker = async () => {
    for (
      let symbol = queue.shift();
      symbol !== undefined;
      symbol = queue.shift()
    ) {
      const current = symbol;
      results.set(
        current,
        await withTimeout(
          resolve(current).catch(() => UNAVAILABLE),
          timeoutMs,
        ),
      );
    }
  };
  const size = Math.max(
    1,
    Math.min(options.concurrency ?? CONCURRENCY, queue.length),
  );
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}
