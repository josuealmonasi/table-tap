import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isLiveRefund, refundableOf } from "./due-provider";

type Db = ReturnType<typeof createAdminClient>;

/** A refund-due attempt as the start and reconcile RPCs return it. */
export interface DueAttempt {
  id: string;
  attempt_no: number;
  amount: number | string;
  idempotency_key: string;
  stripe_account_id: string;
  stripe_payment_intent: string;
  stripe_refund_id?: string | null;
  /** Every live refund the charge had when this attempt's amount was decided. */
  charge_refund_ids?: string[] | null;
}

export type SendGuard =
  | { kind: "send" }
  | { kind: "own"; refund: Stripe.Refund }
  | { kind: "retry"; attempt: DueAttempt }
  | { kind: "completed"; marked: boolean }
  | { kind: "hold" }
  | { kind: "review"; outstandingCents: number }
  | { kind: "failed" };

interface SendContext {
  restaurantId: string;
  dueId: string;
  actor: string;
  intent: string;
  attempt: DueAttempt;
}

/** This attempt's own refund, found by its tag (legacy first attempts carry only the due). */
function isOwn(refund: Stripe.Refund, dueId: string, attempt: DueAttempt): boolean {
  const tag = refund.metadata ?? {};
  return tag.refund_due === dueId
    && (tag.refund_due_attempt === attempt.id || (attempt.attempt_no === 1 && !tag.refund_due_attempt));
}

/** A refund that could be this due's money: made by hand (untagged), or this due's own from another attempt. */
function couldCoverDue(refund: Stripe.Refund, dueId: string): boolean {
  const tag = refund.metadata ?? {};
  return Object.keys(tag).length === 0 || tag.refund_due === dueId;
}

/**
 * Codex bl43 finding 1. Runs right before every refund POST: lists the
 * charge's refunds again and compares them with the ones the attempt froze
 * when its amount was decided. A refund made by hand in that gap would
 * otherwise be paid twice. Nothing new: send as frozen. Something new: the
 * database decides, under the money lock, whether to hold, count it and
 * reopen for the remainder, or stop for a person to review.
 */
export async function guardRefundSend(db: Db, client: Stripe, ctx: SendContext): Promise<SendGuard> {
  const { attempt, intent } = ctx;
  const stripeAccount = attempt.stripe_account_id;
  const listed: Stripe.Refund[] = [];
  for await (const refund of client.refunds.list({ payment_intent: intent, limit: 100 }, { stripeAccount })) {
    if (isOwn(refund, ctx.dueId, attempt)) return { kind: "own", refund };
    listed.push(refund);
  }
  const frozen = new Set(attempt.charge_refund_ids ?? []);
  const live = listed.filter(isLiveRefund);
  const appeared = live.filter(r => !frozen.has(r.id) && couldCoverDue(r, ctx.dueId));
  if (appeared.length === 0) return { kind: "send" };

  const payment = await client.paymentIntents.retrieve(intent, { expand: ["latest_charge"] }, { stripeAccount });
  const { data, error } = await db.rpc("reconcile_refund_due_send_v1", {
    p_restaurant: ctx.restaurantId, p_due: ctx.dueId, p_attempt: attempt.id, p_actor: ctx.actor,
    p_new: appeared.map(r => ({ id: r.id, amount_cents: r.amount, status: r.status })),
    p_refundable_cents: refundableOf(payment.latest_charge as Stripe.Charge | null),
    p_refund_ids: live.map(r => r.id),
  });
  if (error || !data) return { kind: "failed" };
  switch (data.outcome) {
    case "send": return { kind: "send" };
    case "retry": return { kind: "retry", attempt: data.attempt as DueAttempt };
    case "completed": return { kind: "completed", marked: data.marked === true };
    case "review":
      console.error("refund due needs review: still owed, nothing refundable", ctx.dueId, data.outstanding_cents);
      return { kind: "review", outstandingCents: Number(data.outstanding_cents) };
    // "hold", "stale" or "missing": send nothing now; the next request reads again.
    default: return { kind: "hold" };
  }
}
