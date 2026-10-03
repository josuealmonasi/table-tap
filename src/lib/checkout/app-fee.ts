import { feesTakenThisMonth } from "@/lib/fee-month";
import { orderFeeCents } from "@/lib/plan";
import type { RestaurantPlan } from "@/lib/plan-server";

/**
 * What we take from a diner's order, in cents.
 *
 * Worked out before the row is written so it can be recorded on it — the
 * ceiling for the month is summed from these.
 *
 * Capped against the food rather than the amount charged: the tip is the
 * diner's money on its way to the person who served them, and letting it
 * raise the ceiling means a generous table pays us more for the same small
 * order. A deferred order pays nothing here — it settles later, and the
 * fee is taken then.
 */
export async function checkoutFeeCents(
  restaurantId: string,
  plan: RestaurantPlan | null,
  deferred: boolean,
  subtotal: number,
): Promise<number> {
  if (!plan || deferred) return 0;
  const takenThisMonth = plan.limits.fee_cap ? await feesTakenThisMonth(restaurantId) : 0;
  return orderFeeCents(plan.limits, Math.round(subtotal * 100), takenThisMonth);
}
