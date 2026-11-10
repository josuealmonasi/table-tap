import { NextRequest, NextResponse } from "next/server";
import { foundingOpen } from "@/lib/founding";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { foundersTaken, allPlans } from "@/lib/plan-server";
import { actingOwner } from "@/lib/api-guard";
import { isSelfServe, readPlanName } from "@/lib/billing";
import { startRestaurantBilling } from "@/lib/billing-checkout";
import { billingFailure } from "@/lib/billing-operation";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

// POST /api/billing/checkout — the owner subscribes to a tier.
//
// Only the owner: a manager runs the restaurant, but the card is the owner's
// decision. The plan is re-read from our own catalogue rather than trusted
// from the request, so a doctored body can't buy Casa at Servicio's price.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ plan?: unknown; founding?: unknown }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const plan = readPlanName(body.plan);
  if (!plan || !isSelfServe(plan)) return await apiError("apiErr.pickPlan", 400);
  const limits = (await allPlans()).find(p => p.plan === plan);
  if (!limits) return await apiError("apiErr.pickPlan", 400);
  try {
    // The price rises by itself once place 50 fills: computed here, from the same
    // count the Plan screen saw, so what is charged and what was shown cannot
    // disagree.
    const taken = await foundersTaken();
    // The price the owner saw is part of the choice. Place 50 filling between
    // the page and this tap changed a tier at MX$2,499 for a screen showing
    // MX$1,899, invoiced at once with no Stripe page to confirm it (E3).
    if (body.founding !== foundingOpen(taken)) return await apiError("apiErr.billingPriceChanged", 409);
    const origin = siteOrigin(req);
    return NextResponse.json(await startRestaurantBilling(createAdminClient(), actor, limits, taken, origin));
  } catch (err) {
    return await billingFailure(err);
  }
}
