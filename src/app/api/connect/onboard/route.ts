import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { getMembership } from "@/lib/membership";
import { createOnboardingLink, ensureConnectAccount } from "@/lib/stripe-connect";
import { currentUser } from "@/lib/current-user";

export const runtime = "nodejs";

// POST /api/connect/onboard — the owner starts (or resumes) Stripe onboarding.
// Returns a one-time Stripe-hosted onboarding URL for the client to redirect to.
// Owner-only: connecting a bank account is the owner's decision, not a manager's.
export async function POST(req: NextRequest) {
  const membership = await getMembership();
  if (!membership || membership.role !== "owner") {
    return await apiError("apiErr.forbidden", 403);
  }

  const user = await currentUser();
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

  try {
    const accountId = await ensureConnectAccount(membership.restaurant.id, {
      email: user?.email,
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
