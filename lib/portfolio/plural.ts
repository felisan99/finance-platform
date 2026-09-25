/** `1 operación`, `2 operaciones`: el singular solo con exactamente uno. Sin imports: lo usan componentes de cliente. */
export const plural = (count: number, one: string, many: string): string =>
  count === 1 ? one : many;
