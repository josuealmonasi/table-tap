import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { stockDemand, toDemandPayload } from "@/lib/stock";
import type { OrderLineItem } from "@/lib/types";

/**
 * Rolling deployment compatibility only. Older orders did not record what
 * they reserved; keep their former return calculation, inside the transaction.
 * New orders explicitly mark even a zero-reservation checkout as managed, so
 * upgrading a plan later can never credit stock that was not taken.
 */
export async function legacyStockDemand(
  restaurantId: string,
  order: { stock_managed?: boolean; items: OrderLineItem[] | null },
): Promise<{ item_id: string; qty: number }[]> {
  if (order.stock_managed) return [];
  const plan = await getPlan(restaurantId);
  return plan && can(plan.limits, "inventory") ? toDemandPayload(stockDemand(order.items ?? [])) : [];
}
