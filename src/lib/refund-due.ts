import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { refundMadeFor, fullyReturnedCharge, chargeRefundState, refusedAsTooLarge, type RefundCoverage } from "@/lib/refunds/due-provider";
import { reconcileDueFee, verifyDueCurrency } from "@/lib/refunds/due-recovery";

type Db = ReturnType<typeof createAdminClient>;

/** A card payment that arrived for a bill already collected, as Cuentas lists it. */
export interface RefundDueRow {
  id: string;
  amount: number;
  currency: string | null;
  refunded_at: string | null;
  table_label: string | null;
  /** Set when it was a customer account that paid twice, not a table. */
  account_name: string | null;
  created_at: string;
}

export type RefundAnswer =
  | {
      ok: true;
      amount: number;
      /** The diner was already refunded in Stripe; fee recovery is separate. */
      alreadyInStripe: boolean;
      feePending?: boolean;
    }
  | { ok: false; error: string; status: number };

/**
 * What the activity log says about a refund due.
 *
 * Deliberately without a `method`. The corte takes every `refunded` row with
 * one out of the day's takings, which is right for a cancelled order — that
 * money was counted when it came in. This money never was: a double payment
 * is kept out of the ledger, so taking its refund out of the corte would
 * report the day short by exactly what was given back.
 */
export function refundDueLogDetail(amount: number, table: string | null, currency: string | null = null): string {
  return logDetail({ amount: amount.toFixed(2), currency: currency ?? "unverified", table, why: "paid_twice" });
}

/**
 * Gives a diner back a card payment that landed on a bill already collected.
 *
 * Stripe is asked first and the row written after, never the other way: a
 * row marked refunded before the refund exists is a diner told they were paid
 * back who never was, if anything dies in between. Asking again can never
 * refund twice — a refund Stripe already made for this row is found by its
 * tag and reused, and two clicks at once share one idempotency key.
 *
 * The refund is asked of the restaurant's own Stripe account, where the charge
 * lives, for the amount that was taken twice (not always the whole payment),
 * and returns our fee with it in proportion: we do not keep a commission on a
 * sale that did not happen.
 */
export async function refundDue(
  db: Db,
  restaurantId: string,
  id: string,
  actor: string,
  client: Stripe = stripe,
): Promise<RefundAnswer> {
  const { data: due } = await db
    .from("refunds_due")
    .select("id, stripe_payment_intent, stripe_account_id, amount, currency, table_label, refunded_at, fee_reconciled_at")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!due) return { ok: false, error: "apiErr.refundNotFound", status: 404 };
  if (due.refunded_at && due.fee_reconciled_at) return { ok: false, error: "apiErr.alreadyRefunded", status: 409 };

  let currency = due.currency as string | null;
  if (due.refunded_at) {
    // The diner has their money; only our fee is left to recover.
    const { data: settled, error } = await db.rpc("start_refund_due_attempt", { p_restaurant: restaurantId, p_due: id });
    if (error) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
    if (!settled) return { ok: false, error: "apiErr.refundNeedsStripe", status: 409 };
    const returned = await reconcileDueFee(db, restaurantId, id, settled, client);
    return { ok: true, amount: Number(settled.amount), alreadyInStripe: true, ...(!returned && { feePending: true }) };
  }

  // The charge lives on the restaurant's account: the one this due was first
  // tried on, or the restaurant's own.
  let stripeAccount = (due.stripe_account_id as string | null) ?? null;
  if (!stripeAccount) {
    const { data: r, error } = await db.from("restaurants").select("stripe_account_id").eq("id", restaurantId).single();
    if (error) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
    stripeAccount = (r?.stripe_account_id as string | null) ?? null;
  }
  if (!stripeAccount) return { ok: false, error: "apiErr.refundNeedsStripe", status: 409 };
  const intent = due.stripe_payment_intent as string;
  const found = { stripe_account_id: stripeAccount, stripe_payment_intent: intent };
  if (!currency) currency = await verifyDueCurrency(db, restaurantId, id, found, client).catch(() => null);

  // Refunds the restaurant made by hand in Stripe count before we ask for
  // anything (paths audit #7). A due of MX$100 with MX$40 already returned
  // there kept asking for MX$100, Stripe refused anything above the MX$60
  // left, and the due answered 502 for ever with the MX$40 never recorded.
  let charge: Awaited<ReturnType<typeof chargeRefundState>>;
  try {
    charge = await chargeRefundState(client, intent, stripeAccount);
  } catch (err) {
    console.error("refund due: could not read the charge", err);
    return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
  }
  if (charge.manual.length > 0) {
    const { data: recorded, error } = await db.rpc("record_refund_due_coverage_v1", {
      p_restaurant: restaurantId, p_due: id, p_actor: actor, p_refunds: charge.manual,
    });
    if (error) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
    if (recorded?.outcome === "completed") {
      const returned = await reconcileDueFee(db, restaurantId, id, found, client);
      if (recorded.marked === true) {
        await logEvent({
          restaurantId, actor, entity: "bill", action: "refunded",
          detail: refundDueLogDetail(Number(due.amount), (due.table_label as string | null) ?? null, currency),
        });
      }
      return { ok: true, amount: Number(due.amount), alreadyInStripe: true, ...(!returned && { feePending: true }) };
    }
  }

  // An attempt in flight is resumed as it is; a new one is capped at what the
  // charge still has refundable, and never edited afterwards.
  const prepared = await db.rpc("start_refund_due_attempt_v2", {
    p_restaurant: restaurantId, p_due: id, p_refundable_cents: charge.refundableCents,
  });
  if (prepared.error) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
  if (!prepared.data) return { ok: false, error: "apiErr.refundNeedsStripe", status: 409 };
  if (prepared.data.outcome === "none") return { ok: false, error: "apiErr.refundPending", status: 409 };
  let attempt = prepared.data;
  // An attempt is sent on the account it was frozen with.
  stripeAccount = attempt.stripe_account_id as string;

  let coverage: RefundCoverage[] | null = null;
  let alreadyInStripe = false;
  let amount = 0;
  // At most one replacement: only Stripe's own "more than is left" refusal
  // retires an attempt, and the new one is capped at what Stripe says is left.
  for (let pass = 0; ; pass++) {
  amount = Number(attempt.amount);
  const cents = Math.round(amount * 100);
  try {
    const refund = (attempt.stripe_refund_id
      ? await client.refunds.retrieve(attempt.stripe_refund_id, { stripeAccount })
      : await refundMadeFor(client, intent, stripeAccount, id, attempt.id, attempt.attempt_no)) ?? await client.refunds.create(
      { payment_intent: intent, amount: cents, refund_application_fee: true, metadata: { refund_due: id, refund_due_attempt: attempt.id } },
      { idempotencyKey: attempt.idempotency_key, stripeAccount },
    );
    if (refund.status !== "succeeded") {
      // Keep the provider id so a pending attempt is retrieved on retry.
      // The v2 finish stores coverage only for a succeeded status.
      const { error } = await db.rpc("finish_refund_due_attempt_v2", { p_restaurant: restaurantId, p_due: id,
        p_attempt: attempt.id, p_actor: actor, p_refunds: [{ id: refund.id, amount_cents: refund.amount }], p_status: refund.status ?? "pending" });
      if (error) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
    }
    if (refund.status !== "succeeded") return { ok: false, error: "apiErr.refundPending", status: 409 };
    coverage = [{ id: refund.id, amount_cents: refund.amount }];
    break;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    if (pass === 0 && refusedAsTooLarge(err)) {
      // Nothing was created: retire this attempt and open one for what is left.
      const { error: retireError } = await db.rpc("finish_refund_due_attempt_v2", { p_restaurant: restaurantId, p_due: id,
        p_attempt: attempt.id, p_actor: actor, p_refunds: [], p_status: "failed" });
      if (retireError) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
      const fresh = await chargeRefundState(client, intent, stripeAccount).catch(() => null);
      if (!fresh) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
      const { data: next, error: nextError } = await db.rpc("start_refund_due_attempt_v2", {
        p_restaurant: restaurantId, p_due: id, p_refundable_cents: fresh.refundableCents,
      });
      if (nextError) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
      if (!next || next.outcome === "none") return { ok: false, error: "apiErr.refundPending", status: 409 };
      attempt = next;
      continue;
    }
    // The other click, still being answered: its refund is the one.
    if (code === "idempotency_key_in_use") {
      return { ok: false, error: "apiErr.alreadyRefunded", status: 409 };
    }
    if (code !== "charge_already_refunded") {
      console.error("refund due failed:", err);
      return { ok: false, error: "apiErr.refundDueFailed", status: 502 };
    }
    // Somebody refunded it in Stripe by hand, as the bell used to ask. The
    // diner has their money; what is left to give back is our fee.
    coverage = await fullyReturnedCharge(client, intent, stripeAccount).catch(() => null);
    if (!coverage) return { ok: false, error: "apiErr.refundPending", status: 409 };
    alreadyInStripe = true;
    break;
  }
  }

  // Only the request that writes the row says so in the log, so a retry that
  // found the refund already made does not log it twice.
  const { data: marked, error: writeError } = await db.rpc("finish_refund_due_attempt_v2", {
    p_restaurant: restaurantId, p_due: id, p_attempt: attempt.id, p_actor: actor,
    p_refunds: coverage, p_status: "succeeded",
  });
  if (writeError) return { ok: false, error: "apiErr.refundDueFailed", status: 503 };
  // Refused because Stripe has since told us a contributing refund failed:
  // partial coverage still leaves the diner owed, whatever a stale read said.
  if (marked?.outcome !== "completed") {
    return { ok: false, error: "apiErr.refundPending", status: 409 };
  }

  // The share of our fee that went back with it. A charge refunded by hand
  // in Stripe stays counted until verified: the safe way round for the month's ceiling.
  const returned = await reconcileDueFee(db, restaurantId, id, attempt, client);
  if (marked.marked === true) {
    await logEvent({
      restaurantId,
      actor,
      entity: "bill",
      action: "refunded",
      detail: refundDueLogDetail(amount, (due.table_label as string | null) ?? null, currency),
    });
  }
  return { ok: true, amount, alreadyInStripe, ...(!returned && { feePending: true }) };
}
