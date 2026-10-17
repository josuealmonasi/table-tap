import { NO_FEE, reserveFee, type FeeHold } from "@/lib/platform-fee";
import type { RestaurantPlan } from "@/lib/plan-server";

/**
 * The fee we take from a diner's order, reserved under the month's ceiling
 * before the order is written and Stripe is asked (`reserveFee`).
 *
 * Capped against the food rather than the amount charged: the tip is the
 * diner's money on its way to the person who served them, and letting it
 * raise the ceiling means a generous table pays us more for the same small
 * order. A deferred order pays nothing here — it settles later, and the
 * fee is taken then.
 */
export async function checkoutFee(
  restaurantId: string,
  plan: RestaurantPlan | null,
  deferred: boolean,
  subtotal: number,
): Promise<FeeHold> {
  if (!plan || deferred) return NO_FEE;
  return reserveFee(restaurantId, plan.limits, Math.round(subtotal * 100), "order");
}
