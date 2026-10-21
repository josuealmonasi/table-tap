import type { OrderLineItem } from "@/lib/types";

/**
 * Rolling deployment compatibility only. Older orders did not record what
 * they reserved, so their lines and today's plan cannot prove a deduction.
 * Return nothing: the order trigger records that a physical count is needed.
 * New orders explicitly mark even a zero-reservation checkout as managed, so
 * upgrading a plan later can never credit stock that was not taken.
 */
export async function legacyStockDemand(
  restaurantId: string,
  order: { stock_managed?: boolean; items: OrderLineItem[] | null },
): Promise<{ item_id: string; qty: number }[]> {
  // Keep the call shape for deployments still sending the legacy argument.
  void restaurantId;
  void order;
  return [];
}
