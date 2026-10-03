import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

type Db = ReturnType<typeof createAdminClient>;

/** A card payment that arrived for a bill already collected, as Cuentas lists it. */
export interface RefundDueRow {
  id: string;
  amount: number;
  table_label: string | null;
  created_at: string;
}

export type RefundAnswer =
  | {
      ok: true;
      amount: number;
      /** The diner had already been refunded in Stripe; only our fee went back now. */
      alreadyInStripe: boolean;
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
export function refundDueLogDetail(amount: number, table: string | null): string {
  return logDetail({ amount: amount.toFixed(2), table, why: "paid_twice" });
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
    .select("id, stripe_payment_intent, amount, table_label, refunded_at")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!due) return { ok: false, error: "apiErr.refundNotFound", status: 404 };
  if (due.refunded_at) return { ok: false, error: "apiErr.alreadyRefunded", status: 409 };

  const { data: acct } = await db
    .from("restaurants")
    .select("stripe_account_id")
    .eq("id", restaurantId)
    .single();
  const stripeAccount = acct?.stripe_account_id as string | null | undefined;
  if (!stripeAccount) return { ok: false, error: "apiErr.refundNeedsStripe", status: 409 };

  const intent = due.stripe_payment_intent as string;
  const amount = Number(due.amount);
  const cents = Math.round(amount * 100);
  let refundId: string | null = null;
  let alreadyInStripe = false;
  try {
    refundId = (await refundMadeFor(client, intent, stripeAccount, id)) ?? (
      await client.refunds.create(
        {
          payment_intent: intent,
          amount: cents,
          refund_application_fee: true,
          metadata: { refund_due: id },
        },
        { idempotencyKey: `refund-due-${id}`, stripeAccount },
      )
    ).id;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
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
    alreadyInStripe = true;
    await returnOurFee(client, intent, stripeAccount, cents, id).catch(e =>
      console.error("refund due: our fee could not be returned", e),
    );
  }

  // Only the request that writes the row says so in the log, so a retry that
  // found the refund already made does not log it twice.
  const { data: marked } = await db
    .from("refunds_due")
    .update({ refunded_at: new Date().toISOString(), refunded_by: actor, stripe_refund_id: refundId })
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .is("refunded_at", null)
    .select("id");
  if (marked?.length) {
    await logEvent({
      restaurantId,
      actor,
      entity: "bill",
      action: "refunded",
      detail: refundDueLogDetail(amount, (due.table_label as string | null) ?? null),
    });
  }
  return { ok: true, amount, alreadyInStripe };
}

/** A refund Stripe already made for this row, found by the tag it carries. */
async function refundMadeFor(
  client: Stripe,
  paymentIntent: string,
  stripeAccount: string,
  id: string,
): Promise<string | null> {
  const made = await client.refunds.list({ payment_intent: paymentIntent, limit: 100 }, { stripeAccount });
  return made.data.find(r => r.metadata?.refund_due === id)?.id ?? null;
}

/**
 * Our share of the fee on a charge the restaurant refunded by hand.
 *
 * A refund made in the restaurant's own Stripe dashboard leaves our fee where
 * it is. This returns the part of it that belongs to the money given back —
 * all of it when the whole charge was paid twice.
 */
async function returnOurFee(
  client: Stripe,
  paymentIntent: string,
  stripeAccount: string,
  refundedCents: number,
  id: string,
): Promise<void> {
  const intent = await client.paymentIntents.retrieve(
    paymentIntent,
    { expand: ["latest_charge"] },
    { stripeAccount },
  );
  const charge = intent.latest_charge as Stripe.Charge | null;
  const feeId =
    typeof charge?.application_fee === "string" ? charge.application_fee : charge?.application_fee?.id;
  if (!charge?.amount || !feeId) return;
  const fee = await client.applicationFees.retrieve(feeId);
  const share = Math.round((fee.amount * Math.min(refundedCents, charge.amount)) / charge.amount);
  const left = fee.amount - fee.amount_refunded;
  const back = Math.min(share, left);
  if (back <= 0) return;
  await client.applicationFees.createRefund(
    feeId,
    { amount: back, metadata: { refund_due: id } },
    { idempotencyKey: `refund-due-fee-${id}` },
  );
}
