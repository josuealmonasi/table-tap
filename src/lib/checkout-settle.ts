import { closeSessionsFor } from "@/lib/table-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { unpackOrderIds } from "@/lib/stripe-limits";
import type Stripe from "stripe";
import { settleAccountCheckout } from "@/lib/account-checkout";
import { charged, settleCardOrders } from "@/lib/card-settle";

// Abandoning a checkout lives beside it; the webhooks import both from here.
export { abandonCheckout } from "@/lib/checkout-abandon";

/**
 * What a completed or abandoned Stripe Checkout means for the money.
 *
 * Lifted out of the webhook route when the platform and connected-account
 * streams were split into two endpoints. All of this belongs to the connected
 * one: it is a diner's food, charged on the restaurant's own Stripe account.
 * Nothing here touches a subscription, which is the other account entirely.
 *
 * SERVER-ONLY. Every write is made with the secret key, because the only thing
 * vouching for the caller is a signature Stripe put on the request.
 */

/**
 * A payment that arrived. Stripe repeats a webhook it is not sure landed, so
 * every path here has to be safe to run twice — the guards are `.eq("paid",
 * false)` and `.is("paid_at", null)` rather than a flag anybody sets.
 */

/**
 * A payment that arrived, routed to the one thing it settles.
 *
 * Three shapes reach this, told apart by what we stamped on the session at
 * checkout: a share of a divided bill, a whole table being settled at once, or
 * a single order paid as it was placed. Stripe repeats a webhook it is not
 * sure landed, so each is written to be safe to run twice — the guards are
 * `.eq("paid", false)` and `.is("paid_at", null)`, never a flag we set.
 */
export async function settleCheckout(session: Stripe.Checkout.Session): Promise<void> {
  // Only here is a payment believed. A browser coming back from Stripe proves
  // nothing: it is the signature on this request that does.
  if (session.payment_status !== "paid") return;

  if (session.metadata?.account_checkout) return await settleAccountCheckout(session);
  if (session.metadata?.split_id) return await settleSplitShare(session);
  if ((session.metadata?.settle_order_ids ?? "").trim()) return await settleBill(session);
  if (session.metadata?.order_id) return await settleOrder(session);
}

/**
 * One diner's share of a bill the table agreed to divide.
 *
 * Two things arrive together: the share itself, which belongs to no single
 * order, and whatever this diner ordered after the freeze, which belongs
 * entirely to them. The share is recorded against the sitting; the later
 * orders settle the ordinary way.
 *
 * Only when the last share lands does the food the table divided become paid.
 * Before that the bill is genuinely part-paid, and the floor should see
 * exactly that rather than a table that looks settled and is not.
 */
async function settleSplitShare(session: Stripe.Checkout.Session): Promise<void> {
  // `settleCheckout` only routes here when this is set.
  const splitId = session.metadata?.split_id ?? "";
  const db = createAdminClient();
  const shareNo = Number(session.metadata?.split_share ?? -1);
  const shareAmount = Number(session.metadata?.split_amount ?? 0);

  // A failure before anything is written is thrown, so the webhook answers 500
  // and Stripe sends the event again. Read as "no such split" or "not claimed",
  // it answered 200: the diner's money sat in Stripe, recorded nowhere, and
  // nothing would ever ask again. Nothing has been written at that point, and
  // the `paid_at is null` guard makes the retry safe.
  const { data: split, error: splitError } = await db
    .from("bill_splits")
    .select("id, restaurant_id, session_id, shares, status, locked_at")
    .eq("id", splitId)
    .maybeSingle();
  if (splitError) throw new Error(`settling a share: could not read the split: ${splitError.message}`);

  if (split) {
    // Their seat claimed, the money recorded and the gratuity put on the
    // sitting's oldest order, in one write (`settle_split_share`), marked once
    // — a webhook Stripe repeats claims nothing the second time. Stripe
    // charged the share AND the gratuity on it, and the payment carries both:
    // recording only the share said a smaller number arrived than did.
    const tip = Math.max(0, Number(session.metadata?.settle_tip ?? 0));
    const { data: claimed, error: claimError } = await db.rpc("settle_split_share", {
      p_split: splitId,
      p_share: shareNo,
      p_amount: shareAmount,
      p_tip: tip,
      p_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
    });
    if (claimError) throw new Error(`settling a share: could not mark it paid: ${claimError.message}`);

    if (claimed === true) {

      // Our cut, on the same order. It rides on the first share to be paid —
      // one bill divided four ways is still one bill — and it is what the
      // monthly ceiling is summed from, so a share that never recorded it let
      // us take more this month than the ceiling allows.
      const shareFee = Number(session.metadata?.settle_fee ?? 0);
      if (shareFee > 0) await chargeFeeOnSitting(split.session_id as string, shareFee);

      // Anything they ordered after the freeze is theirs, and settles now:
      // the orders and their payments in one write.
      const ownIds = unpackOrderIds(session.metadata);
      if (ownIds.length > 0) {
        // What Stripe took for them: the whole charge less the share and its tip.
        await settleCardOrders(ownIds, session, "settling a share's own orders", {
          charged: charged(session) - shareAmount - tip,
        });
      }
    }

    // The last share closes the pot: everything the table divided is paid
    // for, so the orders it covered stop being owed. Asked on every delivery,
    // not only the one that claimed the share: when closing failed, Stripe
    // sending the event again is what closes it, and that delivery finds the
    // share already claimed.
    await closeDividedBill(splitId, split.session_id as string, split.locked_at as string);
  }
}

/**
 * Every share of a divided bill paid: the orders it covered are settled.
 *
 * No payment is written — each share is already in the ledger against the
 * sitting. Only a count that came back zero closes it. A count that failed was
 * read as zero, and that marked every order the table divided as paid while
 * other diners' shares were still owed: food out, unpaid. Left open instead,
 * the floor sees a part-paid bill, which is the truth. A close that failed is
 * thrown, so Stripe sends the event again.
 */
async function closeDividedBill(splitId: string, sessionId: string, lockedAt: string): Promise<void> {
  const db = createAdminClient();
  const { count: unpaidShares, error: countError } = await db
    .from("bill_split_claims")
    .select("share_no", { count: "exact", head: true })
    .eq("split_id", splitId)
    .is("paid_at", null);
  if (countError) {
    console.error("settling a share: could not count the unpaid shares", countError.message);
    return;
  }
  if (unpaidShares !== 0) return;

  const { data: covered, error } = await db
    .from("orders")
    .update({ paid: true, pay_method: "card" })
    .eq("session_id", sessionId)
    .eq("paid", false)
    .lt("created_at", lockedAt)
    .select("session_id");
  if (error) throw new Error(`settling a share: could not close the divided bill: ${error.message}`);
  await db
    .from("bill_splits")
    .update({ status: "done" })
    .eq("id", splitId);
  await closeSessionsFor(covered ?? [], "paid");
}

/**
 * The oldest order on a sitting, which is the one that carries what belongs to
 * the table rather than to any single dish: the gratuity, and our fee.
 *
 * Settling a whole table puts both on the first of the orders it settled. A
 * divided bill has no such list — the shares belong to the sitting — so it is
 * the same rule stated the only way it can be here.
 */
async function firstOnSitting(sessionId: string): Promise<{ id: string; tip: number; total: number } | null> {
  const { data } = await createAdminClient()
    .from("orders")
    .select("id, tip, total")
    .eq("session_id", sessionId)
    .neq("status", "cancelled")
    .neq("status", "pending_payment")
    .eq("written_off", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, tip: Number(data.tip ?? 0), total: Number(data.total ?? 0) };
}

/** Our cut of a divided bill, recorded once the money is real. */
async function chargeFeeOnSitting(sessionId: string, fee: number): Promise<void> {
  const first = await firstOnSitting(sessionId);
  if (!first) return;
  // Only if nothing has been recorded yet: the fee rides on the first share to
  // be paid, and the shares after it must not each add another.
  await createAdminClient()
    .from("orders")
    .update({ platform_fee: fee })
    .eq("id", first.id)
    .or("platform_fee.is.null,platform_fee.eq.0");
}

/**
 * A whole table settled in one payment: several orders, one card.
 */
async function settleBill(session: Stripe.Checkout.Session): Promise<void> {
  // Across every key the ids were written to, first key first. A session
  // created before the split shipped carries them all in the first one, and
  // reads back the same way.
  const settleIds = unpackOrderIds(session.metadata);
  const db = createAdminClient();

  // The tip was collected against the table, not a dish, so it rides on one
  // order: the first of the ones asked for if this delivery settles it,
  // otherwise the first it does settle — and only ever one THIS delivery
  // settled, because a tip is added to what is there and a repeated delivery
  // must not raise it again. Its payment carries it, so Stripe's MX$7.50 is
  // the ledger's MX$7.50, not MX$2.50 with the tip recorded nowhere.
  const tip = Math.max(0, Number(session.metadata?.settle_tip ?? 0));
  const settled = await settleCardOrders(settleIds, session, "settling a bill", {
    tip,
    tipOrder: settleIds[0],
  });

  // Paid in full is the ordinary way a table empties.
  await closeSessionsFor(settled.sessions, "paid");

  // Our cut of this settlement, recorded on the first of the settled
  // orders — the same row that carries the tip. It is what the monthly
  // ceiling is summed from, so it has to land only once a payment is real.
  const fee = Number(session.metadata?.settle_fee ?? 0);
  if (fee > 0) {
    await db.from("orders").update({ platform_fee: fee }).eq("id", settleIds[0]);
  }

  // The coupon use was reserved when the bill was sent to Stripe; the
  // payment makes it real, and the code is stamped on the order it paid
  // for so the same orders can never take a second one.
  const settleCoupon = session.metadata?.settle_coupon ?? "";
  if (settleCoupon) {
    await db
      .from("orders")
      .update({
        coupon_code: settleCoupon,
        discount: Number(session.metadata?.settle_discount ?? 0),
      })
      .eq("id", settleIds[0]);
    await db
      .from("coupon_redemptions")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("order_id", settleIds[0])
      .is("confirmed_at", null);
  }
}

/**
 * A single order paid at the moment it was placed.
 */
async function settleOrder(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata!.order_id!;

  const supabase = createAdminClient();
  // Only an order still unpaid is touched, and only the delivery that settles
  // it records it: a webhook Stripe repeats settles nothing the second time.
  const settled = await settleCardOrders([orderId], session, "settling an order", { status: "received" });

  // A pay-now order can be the only thing the table owed.
  await closeSessionsFor(settled.sessions, "paid");

  // The coupon use was reserved at checkout; the payment makes it real.
  await supabase
    .from("coupon_redemptions")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .is("confirmed_at", null);
}
