import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What Stripe charged, in pesos. It is how a payment that landed on orders
 * somebody had already settled is found: less is recorded under it than was
 * taken, and `settle_card_orders` keeps the difference as a refund due.
 */
export function charged(session: Stripe.Checkout.Session): number {
  return Math.max(0, (session.amount_total ?? 0) / 100);
}

/** What `settle_card_orders` answers. */
export interface CardSettlement {
  settled: string[];
  /** The order the gratuity was added to, if any was settled. */
  tip_on: string | null;
  /** Orders this payment was for that were already settled some other way. */
  not_settled: string[];
}

/**
 * The orders a card payment was for, marked paid and written to the ledger in
 * one write (`settle_card_orders`): each for its total, the gratuity on one.
 * They were two writes, and a failed second one left orders paid with the
 * diner's money recorded nowhere. A failure is thrown, so the webhook answers
 * 500 and Stripe sends the event again — nothing was written, and the
 * `paid = false` guard makes the repeat safe.
 */
export async function settleCardOrders(
  ids: string[],
  session: Stripe.Checkout.Session,
  what: string,
  opts: { tip?: number; tipOrder?: string; status?: "received"; charged?: number } = {},
): Promise<CardSettlement & { sessions: { session_id: string | null }[] }> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("settle_card_orders", {
    p_orders: ids,
    p_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
    p_tip: opts.tip ?? 0,
    p_tip_order: opts.tipOrder ?? null,
    p_status: opts.status ?? null,
    p_charged: Math.max(0, Math.round((opts.charged ?? charged(session)) * 100) / 100),
  });
  if (error) throw new Error(`${what}: could not mark it paid: ${error.message}`);
  const result = data as CardSettlement;
  if (!result.settled.length) return { ...result, sessions: [] };
  // Which sittings those were, so a table paid in full can clear.
  const { data: sessions } = await db
    .from("orders")
    .select("session_id")
    .in("id", result.settled);
  return { ...result, sessions: (sessions ?? []) as { session_id: string | null }[] };
}
