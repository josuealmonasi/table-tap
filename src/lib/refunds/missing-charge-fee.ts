import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";

interface SavedFee {
  metadata: { fee_cents?: string; fee_id?: string } | null;
  stripe_params: { payment_intent_data?: { application_fee_amount?: number } } | null;
}

/** An asynchronously absent provider object is not evidence of a free charge. */
export async function verifyNoChargeFee(db: ReturnType<typeof createAdminClient>, restaurant: string, intent: string): Promise<void> {
  const [ledger, checkouts] = await Promise.all([
    everyRow<{ cents: number }>((a, b) => db.from("platform_fees").select("cents")
      .eq("restaurant_id", restaurant).eq("stripe_payment_intent", intent).order("id").range(a, b), "the charge's saved platform fees"),
    everyRow<SavedFee>((a, b) => db.from("diner_checkouts").select("metadata, stripe_params")
      .eq("restaurant_id", restaurant).eq("stripe_payment_intent", intent).order("id").range(a, b), "the charge's saved checkout fee"),
  ]);
  if (ledger.some(f => Number(f.cents) > 0) || checkouts.some(c => c.metadata?.fee_id
    || Number(c.metadata?.fee_cents) > 0 || Number(c.stripe_params?.payment_intent_data?.application_fee_amount) > 0)) {
    throw new Error("Platform fee not created yet");
  }
  // No positive evidence: a free charge (ceiling reached, a legacy or account
  // checkout with no saved request). Refusing until a zero is proven left such
  // a charge in the queue for good, and a queued fee blocks deleting the
  // restaurant (review of the sweep 11 fix).
}
