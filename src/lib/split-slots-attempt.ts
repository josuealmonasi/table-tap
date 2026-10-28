import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseFee } from "@/lib/platform-fee";
import { splitRpc } from "@/lib/split-slots-rpc";
import type { SplitOutcome } from "@/lib/split-slots";

export class SplitReservationRejected extends Error {
  constructor(readonly result: SplitOutcome) { super(`Split reservation: ${result.outcome}`); }
}
export interface SlotAttempt {
  id: string; restaurant_id: string; amount_cents: number; stripe_session_id: string | null;
  stripe_params: Stripe.Checkout.SessionCreateParams;
}
/** Replayed from the durable request, including after a lost reservation response. */
export async function prepareSplitSlots(attempt: SlotAttempt): Promise<void> {
  const meta = attempt.stripe_params?.metadata ?? {};
  if (meta.split_model !== "2" || attempt.stripe_session_id) return;
  const result = await splitRpc("reserve_split_slots_v1", {
    p_restaurant: attempt.restaurant_id, p_split: meta.split_id, p_revision: Number(meta.split_revision),
    p_member: meta.split_member, p_slots: JSON.parse(String(meta.split_slots)), p_checkout: attempt.id,
  });
  if (!["reserved", "repeat"].includes(result.outcome)) {
    // A refused selection has no provider page. Retire it only if no earlier
    // reservation exists; an uncertain earlier request must keep its slots.
    const db = createAdminClient();
    const { data, error } = await db.from("bill_split_checkout_slots").select("checkout_id")
      .eq("checkout_id", attempt.id).limit(1);
    if (error) throw new Error("Could not verify the refused slot reservation");
    if (!data?.length) {
      await releaseFee(String(meta.fee_id ?? ""));
      const { error: finishError } = await db.rpc("finish_diner_checkout", { p_attempt: attempt.id, p_paid: false });
      if (finishError) throw new Error("Could not finish the refused split attempt");
    }
    throw new SplitReservationRejected(result);
  }
  // Revision checked under the money lock: neither a stale price nor a fee
  // slice read before a resize may reach Stripe.
  const base = Math.round(Number(meta.split_amount) * 100);
  if (result.amount_cents !== base || Number(meta.fee_cents ?? 0) > Number(result.fee_cents)) {
    throw new Error("Split reservation differs from the frozen checkout");
  }
}
