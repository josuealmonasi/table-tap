import { createAdminClient } from "@/lib/supabase/admin";
import type { SplitSlot } from "@/lib/split-slots";

/** Expose paid and held parts, never the other diner's checkout id or page. */
export async function splitSlots(restaurantId: string, splitId: string): Promise<SplitSlot[]> {
  const { data, error } = await createAdminClient().from("bill_split_slots")
    .select("share_no, amount_cents, fee_slice_cents, payment_id, reserved_checkout_id")
    .eq("restaurant_id", restaurantId).eq("split_id", splitId).order("share_no");
  if (error) throw new Error("Could not read the split's parts");
  return (data ?? []).map(s => ({ shareNo: s.share_no, amountCents: s.amount_cents, feeCents: s.fee_slice_cents,
    paid: Boolean(s.payment_id), paying: Boolean(s.reserved_checkout_id) && !s.payment_id }));
}
