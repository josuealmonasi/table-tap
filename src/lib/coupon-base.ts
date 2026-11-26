import { round2 } from "@/lib/money";

/** The stored figures of an order that say what its dishes came to. */
export interface DishesSource {
  total: number | string;
  tip?: number | string | null;
  service_fee?: number | string | null;
}

/**
 * What a coupon is judged and spread on: the dishes, never the service charge
 * or a gratuity.
 *
 * The cart prices a coupon on the dishes before service is added, so every
 * later place a coupon meets a bill has to use the same base: the diner paying
 * at the table (`bill/pay`, the bill screen) and the floor applying one from
 * the till (`bill/discount`, its approval and its list of options). They once
 * disagreed — staff judged MX$90 of food plus MX$15 of service as MX$105 and
 * passed a MX$100 minimum the diner's own screen refused (2026-11-26). The SQL
 * writers (`apply_bill_discount_v2`, `approve_discount_request_v3`) spell the
 * same rule as `greatest(total - tip - service_fee, 0)`.
 */
export function dishesOf(order: DishesSource): number {
  return round2(rawDishes(order));
}

/**
 * The coupon base of several orders: each one's dishes, added up and rounded
 * once at the end, as the SQL's `sum(greatest(...))` does.
 */
export function couponBase(orders: DishesSource[]): number {
  return round2(orders.reduce((sum, o) => sum + rawDishes(o), 0));
}

function rawDishes(order: DishesSource): number {
  return Math.max(0, Number(order.total) - Number(order.tip ?? 0) - Number(order.service_fee ?? 0));
}
