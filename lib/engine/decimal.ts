import Decimal from "decimal.js";

// Constructor aislado: ningún `Decimal.set(...)` global (de otro módulo o de una
// dependencia) puede alterar la precisión ni el redondeo del motor.
export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export type Dec = Decimal;

export const ZERO: Dec = new D(0);

// Tolerancia de cantidad (spec §6.7): por debajo de esto una posición se considera cerrada.
export const QTY_EPSILON: Dec = new D("1e-9");

// Solo strings o Decimals: los `number` de JS son floats y no entran al motor
// (los valores que vienen de la base se convierten en la capa db).
export function d(value: string | Dec): Dec {
  return new D(value);
}
