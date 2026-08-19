/**
 * El precio de fundador.
 *
 * Los primeros restaurantes que contratan se quedan con el precio con el que
 * entraron. No es un descuento: es el mismo precio, con la promesa de que no
 * sube — que es lo que de verdad le importa a un negocio que presupuesta en
 * cientos de pesos.
 *
 * También es lo que vuelve honesto el precio tachado. Hoy el precio de lista
 * es un número que nadie paga; cuando se acaben estos lugares será el precio
 * real de quien llegue después.
 */

/** Cuántos lugares hay. Cambiarlo aquí lo cambia en todas partes. */
export const FOUNDING_SLOTS = 50;

/** Lugares que quedan, nunca negativo. */
export function slotsLeft(taken: number): number {
  return Math.max(0, FOUNDING_SLOTS - taken);
}

/** ¿Todavía se puede entrar como fundador? */
export function foundingOpen(taken: number): boolean {
  return slotsLeft(taken) > 0;
}

/**
 * Cuánto se ahorra un fundador al año contra el precio de lista.
 *
 * El argumento no es el ahorro de un mes: es que el precio no sube nunca.
 */
export function yearlySaving(locked: number, list: number | null | undefined): number {
  if (!list || list <= locked) return 0;
  return (list - locked) * 12;
}
