import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { getMembership } from "@/lib/membership";
import { createOnboardingLink, ensureConnectAccount } from "@/lib/stripe-connect";

export const runtime = "nodejs";

// POST /api/connect/onboard — the owner starts (or resumes) Stripe onboarding.
// Returns a one-time Stripe-hosted onboarding URL for the client to redirect to.
// Owner-only: connecting a bank account is the owner's decision, not a manager's.
export async function POST(req: NextRequest) {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  // Stripe wants the account's currency, which is a restaurant field rather
  // than part of the caller's identity. getMembership is memoised for this
  // request, so asking again costs nothing.
  const membership = await getMembership();
  if (!membership) return await apiError("apiErr.forbidden", 403);

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

  try {
    const accountId = await ensureConnectAccount(actor.restaurantId, {
      email: actor.email,
      currency: membership.restaurant.currency,
    });
    const url = await createOnboardingLink(accountId, origin);
    return NextResponse.json({ url });
  } catch (err) {
    // Surface a clean message, not a 500, if Stripe rejects the request.
    console.error("connect onboard error", err);
    return await apiError("apiErr.stripeOnboard", 502);
  }
}
