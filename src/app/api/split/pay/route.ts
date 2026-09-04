import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTableBill } from "@/lib/bill-data";
import { getPlan } from "@/lib/plan-server";
import { orderFeeCents } from "@/lib/plan";
import { feesTakenThisMonth } from "@/lib/fee-month";
import { round2 } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paying one share of a divided bill.
 *
 * What is charged is the share frozen when the table agreed, plus whatever this
 * diner ordered afterwards — theirs alone, by the rule the table follows. Both
 * halves are read from the database here; the phone sends which orders it
 * thinks are its own and they are checked before a centavo is added.
 *
 * The tip is this person's own: the table agreed to divide the food and the
 * service charge, not to decide each other's generosity.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`splitpay:${clientIp(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const { splitId, sessionId, diner, restaurantId, tableId, ownOrderIds, tipPct, tipAmount } =
    (await req.json()) as {
      splitId?: string; sessionId?: string; diner?: string; restaurantId?: string;
      tableId?: string; ownOrderIds?: string[]; tipPct?: number; tipAmount?: number;
    };
  if (!splitId || !sessionId || !diner || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();

  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, name, currency, stripe_account_id, stripe_charges_enabled")
    .eq("id", restaurantId)
    .single();
  if (!restaurant) return await apiError("apiErr.restaurantNotFound", 404);
  if (!restaurant.stripe_account_id || !restaurant.stripe_charges_enabled) {
    return await apiError("apiErr.noCardPayments", 409);
  }

  const { data: split } = await db
    .from("bill_splits")
    .select("id, status, locked_at, session_id, shares")
    .eq("id", splitId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!split || split.status !== "locked") return await apiError("apiErr.splitNotReady", 409);

  const { data: claim } = await db
    .from("bill_split_claims")
    .select("share_no, amount, paid_at")
    .eq("split_id", splitId)
    .eq("diner", diner)
    .maybeSingle();
  if (!claim) return await apiError("apiErr.splitNotYours", 403);
  if (claim.paid_at) return await apiError("apiErr.splitAlreadyPaid", 409);

  // Their own orders since the freeze — verified, never taken on trust: unpaid,
  // at this table's sitting, and placed after it locked.
  const orders = await fetchTableBill(restaurantId, tableId, "diner", sessionId);
  const wanted = new Set(Array.isArray(ownOrderIds) ? ownOrderIds : []);
  // Parsed, never compared as text: Postgres returns "+00:00" where JavaScript
  // writes "Z", and as strings that can sort the wrong way round.
  const froze = Date.parse(split.locked_at as string);
  const own = orders.filter(
    o => wanted.has(o.id) && !o.paid && Date.parse(o.created_at) > froze,
  );
  const ownTotal = round2(own.reduce((sum, o) => sum + Number(o.total), 0));

  const payable = round2(Number(claim.amount) + ownTotal);
  if (payable <= 0) return await apiError("apiErr.billSettled", 409);

  const pct = Math.min(100, Math.max(0, Number(tipPct) || 0));
  const asked = tipAmount != null ? Number(tipAmount) : (payable * pct) / 100;
  const tip = Math.min(Math.max(0, round2(asked)), payable);
  const cents = Math.round(round2(payable + tip) * 100);

  // Our cut is the table's, not one per person: a bill divided four ways is
  // still one bill, and charging the restaurant four times for the courtesy of
  // splitting it would be a fee for using the feature. It rides on the first
  // share to be paid, the same way settling a table puts it on the first order.
  const { count: alreadyPaid } = await db
    .from("bill_split_claims")
    .select("share_no", { count: "exact", head: true })
    .eq("split_id", splitId)
    .not("paid_at", "is", null);
  const feePlan = await getPlan(restaurantId);
  const takenThisMonth = feePlan?.limits.fee_cap ? await feesTakenThisMonth(restaurantId) : 0;
  const appFee =
    (alreadyPaid ?? 0) === 0 && feePlan
      ? orderFeeCents(feePlan.limits, Math.round(payable * 100), takenThisMonth)
      : 0;

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: restaurant.currency.toLowerCase(),
              unit_amount: cents,
              product_data: { name: `${restaurant.name} — 1/${split.shares}` },
            },
          },
        ],
        // The webhook is the only thing that believes any of this happened.
        metadata: {
          split_id: splitId,
          split_share: String(claim.share_no),
          split_amount: String(claim.amount),
          settle_order_ids: own.map(o => o.id).join(","),
          settle_tip: String(tip),
          settle_fee: String(appFee / 100),
        },
        payment_intent_data: {
          ...(appFee > 0 ? { application_fee_amount: appFee } : {}),
        },
        // Half an hour, for the same reason a cart gets one: a share left
        // unpaid on a Stripe page must not hold the table's bill open all day.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        success_url: `${origin}/r/${restaurantId}/t/${tableId}?settled=1`,
        cancel_url: `${origin}/r/${restaurantId}/t/${tableId}?cancelled=1`,
      },
      { stripeAccount: restaurant.stripe_account_id },
    );

    if (!session.url) return await apiError("apiErr.generic", 502);
    return NextResponse.json({ url: session.url });
  } catch {
    return await apiError("apiErr.generic", 502);
  }
}
