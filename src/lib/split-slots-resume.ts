import { createAdminClient } from "@/lib/supabase/admin";
import { splitCents, splitSelection, type SplitResumption } from "@/lib/split-slots";

/** Only this approved phone may see the parts and tip in its saved requests. */
export async function splitResumptions(restaurantId: string, splitId: string, revision: number, memberId: string): Promise<SplitResumption[]> {
  const { data, error } = await createAdminClient().from("diner_checkouts")
    .select("metadata, amount_cents, scope_key")
    .eq("restaurant_id", restaurantId).eq("split_id", splitId).eq("split_revision", revision)
    .eq("payer_member_id", memberId).eq("status", "open");
  if (error) throw new Error("Could not read this phone's split payments");
  return (data ?? []).map(attempt => {
    const meta = attempt.metadata ?? {};
    const slots: unknown = JSON.parse(String(meta.split_slots));
    const tipCents = Math.round(Number(meta.settle_tip ?? 0) * 100);
    const amountCents = Number(attempt.amount_cents);
    // A retry must address the same durable scope, never a fresh selection.
    if (!splitSelection(slots) || !splitCents(tipCents) || !splitCents(amountCents)
      || attempt.scope_key !== `split2:${splitId}:${revision}:${memberId}:${[...slots].sort((a, b) => a - b).join(",")}`) {
      throw new Error("Saved split payment differs from its parts");
    }
    return { slots, tipCents, amountCents };
  });
}
