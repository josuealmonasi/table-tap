import { createAdminClient } from "@/lib/supabase/admin";
import { splitSlots, splitFrozen } from "@/lib/split-slots-state";
import type { SplitState } from "@/lib/split-service";
import type { SplitScope } from "@/lib/split-slots";

export interface StaffSlotSplit extends SplitState, SplitScope {}

/** Only the staff route calls this, with orders already scoped to its restaurant and table. */
export async function staffSlotSplits(restaurantId: string, tableId: string,
  orders: { session_id?: string | null }[]): Promise<StaffSlotSplit[]> {
  const sessions = [...new Set(orders.map(o => o.session_id).filter((s): s is string => Boolean(s)))];
  if (!sessions.length) return [];
  const { data, error } = await createAdminClient().from("bill_splits")
    .select("id, session_id, model_version, revision, shares, amount, status, proposed_by, currency, first_payment_attempt_at")
    .eq("restaurant_id", restaurantId).in("session_id", sessions).eq("model_version", 2).in("status", ["proposed", "locked"]);
  if (error) throw new Error("Could not read the table's divided bills");
  return await Promise.all((data ?? []).map(async split => {
    const slots = await splitSlots(restaurantId, split.id);
    return { restaurantId, tableId, sessionId: split.session_id, id: split.id, modelVersion: 2,
      revision: split.revision, shares: split.shares, amount: Number(split.amount), status: split.status as SplitState["status"],
      proposedBy: split.proposed_by, currency: split.currency, frozen: splitFrozen(split.first_payment_attempt_at, slots),
      slots, joined: slots.filter(s => s.paid).length, mine: null, ownSince: 0,
      outstanding: slots.filter(s => !s.paid).reduce((sum, s) => sum + s.amountCents, 0) / 100 };
  }));
}
