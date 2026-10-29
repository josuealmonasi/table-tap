import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCheckoutPages, type CheckoutPageResolution } from "@/lib/whole-bill-pages";

/** Only the selected parts' owners can be retired; another part stays usable. */
export async function resolveSelectedSplitPages(restaurantId: string, splitId: string, slots: number[]): Promise<CheckoutPageResolution> {
  try {
    const { data, error } = await createAdminClient().from("bill_split_slots")
      .select("share_no, reserved_checkout_id, payment_id").eq("restaurant_id", restaurantId)
      .eq("split_id", splitId).in("share_no", slots);
    if (error || !data || data.length !== slots.length) return "unverified";
    if (data.some(s => s.payment_id)) return "unresolved";
    const ids = [...new Set(data.map(s => s.reserved_checkout_id).filter((id): id is string => Boolean(id)))];
    if (!ids.length) return "closed";
    return await resolveCheckoutPages(restaurantId, { checkoutIds: ids, splitId });
  } catch { return "unverified"; }
}
