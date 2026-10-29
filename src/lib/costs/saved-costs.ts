import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRowIn } from "@/lib/paged";

interface SavedCost {
  source_id: string;
  cost_currency?: string | null;
  /** Whole sold lines, including quantity, combo parts and extras; null is unknown. */
  line_costs?: unknown;
}

/** Read only frozen valuations. Older quantity-only snapshots stay incomplete. */
export async function withSavedCosts<T extends { id: string; currency: string; items: unknown[] }>(
  db: ReturnType<typeof createAdminClient>, restaurant: string, orders: T[],
): Promise<(T & { ingredient_costs: (number | null)[] })[]> {
  const saved = await everyRowIn<SavedCost>(orders.map(o => o.id), (ids, a, b) => db.from("ingredient_consumption")
    // The valuation fields arrive with Claude's SQL. Selecting the whole private
    // snapshot also works before that rollout: missing fields mean unknown cost.
    .select("*").eq("restaurant_id", restaurant).eq("source_kind", "sale")
    .in("source_id", ids).order("source_id").range(a, b), "the saved ingredient costs");
  const byOrder = new Map(saved.map(s => [s.source_id, s]));
  return orders.map(order => {
    const snapshot = byOrder.get(order.id);
    const values = snapshot?.cost_currency === order.currency && Array.isArray(snapshot.line_costs)
      && snapshot.line_costs.length === order.items.length ? snapshot.line_costs : [];
    return { ...order, ingredient_costs: order.items.map((_, i) => {
      const value: unknown = values[i];
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    }) };
  });
}
