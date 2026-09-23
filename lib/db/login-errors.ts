// `?error=` lo agrega /auth/callback cuando el enlace de acceso no se pudo canjear.
const MESSAGES = {
  link: "El enlace no funcionó: venció, ya se usó o lo abriste en otro navegador. Pedí uno nuevo desde acá.",
} as const;

/**
 * Mensaje para un código de error de la URL, o `undefined` si no es uno conocido.
 * El código viene de la URL (lo controla quien la escribe): solo se aceptan claves propias del
 * objeto, así `?error=constructor` o `?error=__proto__` no devuelven miembros del prototipo.
 */
export function loginErrorMessage(
  code: string | undefined,
): string | undefined {
  if (code === undefined || !Object.hasOwn(MESSAGES, code)) return undefined;
  return MESSAGES[code as keyof typeof MESSAGES];
}
