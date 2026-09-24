import { cleanText } from "./sanitize";

export type MarketDataErrorKind =
  /** El proveedor no conoce el símbolo (inexistente, renombrado o dado de baja). No se reintenta. */
  | "NOT_FOUND"
  /** 429: hay que bajar el ritmo. Se reintenta con espera. */
  | "RATE_LIMITED"
  /** Red caída, 5xx, bloqueo (401/403) o timeout. Se reintenta. */
  | "UNAVAILABLE"
  /** La respuesta no tiene el formato esperado (Yahoo cambió algo). No se reintenta. */
  | "BAD_DATA"
  /** El pedido es inválido (símbolo con formato raro, ventana al revés). No se reintenta. */
  | "BAD_REQUEST";

export class MarketDataError extends Error {
  readonly kind: MarketDataErrorKind;
  readonly symbol: string | undefined;

  constructor(
    kind: MarketDataErrorKind,
    message: string,
    options: { symbol?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MarketDataError";
    this.kind = kind;
    this.symbol = options.symbol;
  }

  get retryable(): boolean {
    return this.kind === "RATE_LIMITED" || this.kind === "UNAVAILABLE";
  }
}

/** Solo los errores transitorios (ver `MarketDataErrorKind`) merecen otro intento. */
export function isRetryable(error: unknown): boolean {
  return error instanceof MarketDataError && error.retryable;
}

// Mensajes de Yahoo para símbolos inexistentes o dados de baja. No se usa "not found" a secas:
// también aparece en errores de red (ENOTFOUND) que sí merecen reintento.
const NOT_FOUND_MESSAGE =
  /no data found|symbol may be delisted|symbol not found|quote not found/i;

/**
 * Clasifica lo que lanza `yahoo-finance2`. Mira el `name` y el `code` en vez de `instanceof`
 * para no depender de cómo empaquete la librería sus clases de error.
 */
export function classifyYahooError(
  error: unknown,
  symbol?: string,
): MarketDataError {
  if (error instanceof MarketDataError) return error;

  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const status = typeof code === "number" ? code : undefined;
  const opts = { symbol, cause: error };

  if (NOT_FOUND_MESSAGE.test(message) || status === 404) {
    return new MarketDataError(
      "NOT_FOUND",
      "símbolo desconocido para el proveedor",
      opts,
    );
  }
  if (status === 429) {
    return new MarketDataError(
      "RATE_LIMITED",
      "el proveedor limitó el ritmo (429)",
      opts,
    );
  }
  if (name === "FailedYahooValidationError") {
    return new MarketDataError(
      "BAD_DATA",
      "respuesta del proveedor con formato inesperado",
      opts,
    );
  }
  if (name === "BadRequestError" || name === "InvalidOptionsError") {
    return new MarketDataError(
      "BAD_REQUEST",
      "el proveedor rechazó el pedido",
      opts,
    );
  }
  const detail =
    status !== undefined
      ? `HTTP ${status}`
      : (cleanText(message, 80) ?? "error de red");
  return new MarketDataError(
    "UNAVAILABLE",
    `proveedor no disponible (${detail})`,
    opts,
  );
}

/** Descripción corta y sin datos internos para el log de corridas (sin stack ni cabeceras). */
export function describeError(error: unknown): string {
  const text =
    error instanceof MarketDataError
      ? `${error.kind}${error.symbol ? ` ${error.symbol}` : ""}: ${error.message}`
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
  return cleanText(text, 300) ?? "error desconocido";
}
