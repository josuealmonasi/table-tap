import { createAdminClient } from "@/lib/supabase/admin";

export class PaymentAttributionRequired extends Error {}

/** Coverage belongs to an order, including while its return is pending. */
export async function paymentCoverage(restaurantId: string, orders: { id: string }[], allowUnresolved = false): Promise<Map<string, number>> {
  if (!orders.length) return new Map();
  const { data, error } = await createAdminClient().rpc("order_coverage", {
    p_restaurant: restaurantId, p_orders: orders.map(o => o.id),
  });
  if (error) throw new Error(`Could not read payment coverage: ${error.message}`);
  if (!allowUnresolved && (data as { unresolved?: boolean }[] ?? []).some(r => r.unresolved)) throw new PaymentAttributionRequired();
  return new Map((data as { id: string; amount: number }[] ?? []).map(a => [a.id, Number(a.amount)]));
}

export async function paymentCoverageDetails(restaurantId: string, orders: { id: string }[], allowUnresolved = false): Promise<Map<string, { amount: number; tip: number }>> {
  if (!orders.length) return new Map();
  const { data, error } = await createAdminClient().rpc("order_coverage", {
    p_restaurant: restaurantId, p_orders: orders.map(o => o.id),
  });
  if (error) throw new Error(`Could not read payment coverage: ${error.message}`);
  if (!allowUnresolved && (data as { unresolved?: boolean }[] ?? []).some(r => r.unresolved)) throw new PaymentAttributionRequired();
  return new Map((data as { id: string; amount: number; tip: number }[] ?? []).map(a => [a.id, { amount: Number(a.amount), tip: Number(a.tip) }]));
}
