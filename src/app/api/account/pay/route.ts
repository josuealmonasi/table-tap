import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { normalizeCode } from "@/lib/accounts";
import { accountByCode } from "@/lib/accounts-server";
import { releaseAccountCheckout } from "@/lib/account-checkout";
import { stripeProductName } from "@/lib/stripe-limits";
import { orderFeeCents } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { feesTakenThisMonth } from "@/lib/fee-month";
import { round2 } from "@/lib/money";

export const runtime = "nodejs";

// POST /api/account/pay — the customer pays their whole account by card.
//
// Body: { c, expected, tipPct?, tipAmount? } — `c` is the account's code and
// `expected` the balance the statement showed. The database opens the payment
// on exactly the orders owed now and holds the account against being
// collected at the till until Stripe answers; the webhook is what records it.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`account-pay:${clientKey(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }
  const body = await jsonBody<{ c?: unknown; expected?: unknown; tipPct?: unknown; tipAmount?: unknown }>(req);
  const code = normalizeCode(typeof body?.c === "string" ? body.c : "");
  const expected = Number(body?.expected);
  if (!code || !Number.isFinite(expected) || expected <= 0) return await apiError("apiErr.invalidRequest", 400);

  const account = await accountByCode(code).catch(() => undefined);
  if (account === undefined) return await apiError("apiErr.generic", 500);
  if (!account) return await apiError("account.notFound", 404);

  const db = createAdminClient();
  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, name, currency, stripe_account_id, stripe_charges_enabled")
    .eq("id", account.restaurant_id)
    .maybeSingle();
  if (!restaurant) return await apiError("apiErr.generic", 500);
  if (!restaurant.stripe_account_id || !restaurant.stripe_charges_enabled) {
    return await apiError("apiErr.noCardPayments", 409);
  }

  // The same gratuity rule as a table's bill: a percentage or an amount, and
  // never more than the food it thanks somebody for.
  const pct = Math.min(100, Math.max(0, Number(body?.tipPct) || 0));
  const asked = body?.tipAmount != null ? Number(body.tipAmount) : (expected * pct) / 100;
  const tip = Math.min(Math.max(0, round2(Number.isFinite(asked) ? asked : 0)), expected);

  // One card payment for one account: the single fee an order carries,
  // capped against the food and not the tip.
  const plan = await getPlan(restaurant.id);
  const taken = plan?.limits.fee_cap ? await feesTakenThisMonth(restaurant.id) : 0;
  const feeCents = plan ? orderFeeCents(plan.limits, Math.round(expected * 100), taken) : 0;

  const { data: opened, error: openError } = await db.rpc("account_checkout_open", {
    p_restaurant: restaurant.id,
    p_account: account.id,
    p_expected: expected,
    p_tip: tip,
    p_fee: feeCents / 100,
  });
  if (openError) return await apiError("apiErr.generic", 500);
  const r = opened as { outcome: string; checkout?: string; amount?: number; tip?: number };
  if (r.outcome === "paying") return await apiError("apiErr.accountPayingOnline", 409);
  if (r.outcome === "nothing") return await apiError("apiErr.accountNothingOwed", 409);
  if (r.outcome === "changed") return await apiError("apiErr.accountStatementChanged", 409);
  if (r.outcome !== "open" || !r.checkout) return await apiError("apiErr.generic", 500);

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const cents = Math.round(round2(Number(r.amount) + Number(r.tip)) * 100);
  try {
    const session = await new Stripe(process.env.STRIPE_SECRET_KEY!).checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: restaurant.currency.toLowerCase(),
              unit_amount: cents,
              product_data: { name: stripeProductName(`${restaurant.name} — ${account.name}`) },
            },
          },
        ],
        // The webhook settles exactly this checkout. A returning browser
        // proves nothing about whether money moved.
        metadata: { account_checkout: r.checkout },
        payment_intent_data: feeCents > 0 ? { application_fee_amount: feeCents } : {},
        success_url: `${origin}/cuenta/${code}?paid=1`,
        cancel_url: `${origin}/cuenta/${code}?cancelled=1`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      { stripeAccount: restaurant.stripe_account_id },
    );
    await db.from("account_checkouts").update({ stripe_session_id: session.id }).eq("id", r.checkout);
    return NextResponse.json({ url: session.url });
  } catch {
    // The charge never happened: the till may collect this account again.
    await releaseAccountCheckout(r.checkout);
    return await apiError("apiErr.checkoutFailed", 502);
  }
}
