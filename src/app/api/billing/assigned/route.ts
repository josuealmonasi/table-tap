import { NextRequest, NextResponse } from "next/server";
import { actingOwner } from "@/lib/api-guard";
import { readPlanName } from "@/lib/billing";
import { startRestaurantBilling } from "@/lib/billing-checkout";
import { BillingError } from "@/lib/billing-operation";
import { foundersTaken, allPlans } from "@/lib/plan-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

// GET /api/billing/assigned?plan=<tier> — the link in the email a platform
// admin's tier assignment sends (`assignTier`, billing "payment_link"). It
// opens Stripe Checkout for that tier, which the owner confirms on Stripe's
// own page, with the price on it.
//
// Only for the tier the restaurant was actually given and has not paid yet
// (on it, trialing, no subscription): Grupo is not self-serve, and this link
// must not become a way to buy a tier nobody assigned. Anything else goes to
// the Plan screen, which shows the restaurant where it stands.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = siteOrigin(req);
  const actor = await actingOwner();
  if (!actor) return NextResponse.redirect(`${origin}/login`, 303);
  const plan = readPlanName(req.nextUrl.searchParams.get("plan"));
  const toPlanScreen = NextResponse.redirect(`${origin}/dashboard/plan`, 303);
  if (!plan || plan === "carta") return toPlanScreen;

  const db = createAdminClient();
  const { data: restaurant } = await db.from("restaurants")
    .select("plan, plan_status, stripe_subscription_id").eq("id", actor.restaurantId).maybeSingle();
  if (!restaurant || restaurant.plan !== plan || restaurant.plan_status !== "trialing" || restaurant.stripe_subscription_id) {
    return toPlanScreen;
  }
  const limits = (await allPlans()).find(p => p.plan === plan);
  if (!limits) return toPlanScreen;
  try {
    const { url } = await startRestaurantBilling(db, actor, limits, await foundersTaken(), origin);
    return NextResponse.redirect(url, 303);
  } catch (err) {
    if (!(err instanceof BillingError)) console.error("assigned tier checkout failed", err);
    return toPlanScreen;
  }
}
