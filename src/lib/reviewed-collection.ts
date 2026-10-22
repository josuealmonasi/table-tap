import { createAdminClient } from "@/lib/supabase/admin";
import type { Actor } from "@/lib/api-guard";

export interface ReviewedCollection { tableId: string; expected: number; currency: string }

/** The reviewed balance and the receipt are checked in the same money transaction. */
export async function recordReviewed(actor: Actor, review: ReviewedCollection, amount: number, tip: number, method: string, ref: string) {
  const { data, error } = await createAdminClient().rpc("collect_table_reviewed_v1", {
    p_restaurant: actor.restaurantId, p_table: review.tableId, p_expected: review.expected,
    p_currency: review.currency, p_amount: amount - tip, p_tip: tip, p_method: method, p_actor: actor.email, p_ref: ref,
  });
  if (error) throw new Error(`Could not record the reviewed collection: ${error.message}`);
  const r = data as { outcome: string; amount: number; tip: number; owed: number; currency: string };
  return { wrote: r.outcome === "written", refused: r.outcome === "duplicate", covered: false,
    changed: r.outcome === "changed", paying: r.outcome === "paying", landed: Number(r.amount ?? 0), tip: Number(r.tip ?? 0), owed: Number(r.owed), currency: r.currency };
}
