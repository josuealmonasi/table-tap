import { createAdminClient } from "@/lib/supabase/admin";
import { splitCents, splitSelection, type SplitResumption } from "@/lib/split-slots";

/** Only this approved phone may see the parts and tip in its saved requests. */
export async function splitResumptions(restaurantId: string, splitId: string, revision: number, memberId: string): Promise<SplitResumption[]> {
  const { data, error } = await createAdminClient().from("diner_checkouts")
    .select("metadata, amount_cents, scope_key")
    .eq("restaurant_id", restaurantId).eq("split_id", splitId).eq("split_revision", revision)
    .eq("payer_member_id", memberId).eq("status", "open");
  if (error) throw new Error("Could not read this phone's split payments");
  return (data ?? []).flatMap(attempt => {
    const meta = attempt.metadata ?? {};
    let slots: unknown = null;
    try { slots = JSON.parse(String(meta.split_slots)); } catch { slots = null; }
    const tipCents = Math.round(Number(meta.settle_tip ?? 0) * 100);
    const amountCents = Number(attempt.amount_cents);
    // A retry must address the same durable scope, never a fresh selection.
    // One that does not is not offered, but it must not blank the phone's
    // whole split: throwing here answered 500 and the diner saw no parts and
    // nothing to press (#574's gates). Its parts stay held, so nothing is paid twice.
    if (!splitSelection(slots) || !splitCents(tipCents) || !splitCents(amountCents)
      || attempt.scope_key !== `split2:${splitId}:${revision}:${memberId}:${[...slots].sort((a, b) => a - b).join(",")}`) {
      console.error("split resumption: a saved payment differs from its parts; not offered");
      return [];
    }
    return [{ slots, tipCents, amountCents }];
  });
}
