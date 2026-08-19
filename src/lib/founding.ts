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
 * El precio que paga quien contrata en este momento.
 *
 * Se calcula, no se guarda. Cuando se llena el lugar 50 el precio sube solo,
 * sin que nadie tenga que acordarse de editar la tabla de planes — y si algún
 * día se quieren abrir más lugares, basta con mover FOUNDING_SLOTS y el precio
 * vuelve a bajar. Cambiar monthly_price a mano habría sido irreversible y una
 * cosa más que se puede olvidar.
 *
 * A quien ya está suscrito no le afecta: Stripe no re-tarifica una suscripción
 * viva, y ese es justamente el candado.
 */
export function currentPrice(
  limits: { monthly_price: number; list_price?: number | null },
  taken: number,
): number {
  if (foundingOpen(taken)) return limits.monthly_price;
  return limits.list_price ?? limits.monthly_price;
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
