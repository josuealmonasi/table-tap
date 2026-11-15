import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManagerWithRestaurant } from "@/lib/api-guard";
import { createOnboardingLink, ensureConnectAccount } from "@/lib/stripe-connect";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

// POST /api/connect/onboard — the owner starts (or resumes) Stripe onboarding.
// Returns a one-time Stripe-hosted onboarding URL for the client to redirect to.
// Owner-only: connecting a bank account is the owner's decision, not a manager's.
export async function POST(req: NextRequest) {
  const found = await actingManagerWithRestaurant();
  if (!found || found.actor.role !== "owner") return await apiError("apiErr.forbidden", 403);
  const { actor, restaurant } = found;

  // Stripe wants the account's currency, which is a restaurant field rather
  // than part of the caller's identity. Reuse the guard's lookup: route handlers
  // get no React cache memo, so asking again pays for auth and membership twice.
  const origin = siteOrigin(req);

  try {
    const accountId = await ensureConnectAccount(actor.restaurantId, {
      email: actor.email,
      currency: restaurant.currency,
    });
    const url = await createOnboardingLink(accountId, origin);
    return NextResponse.json({ url });
  } catch (err) {
    // Surface a clean message, not a 500, if Stripe rejects the request.
    console.error("connect onboard error", err);
    return await apiError("apiErr.stripeOnboard", 502);
  }
}
