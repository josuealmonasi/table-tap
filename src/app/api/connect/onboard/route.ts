import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import { stripe } from "@/lib/stripe";
import { ensureConnectAccount } from "@/lib/stripe-connect";

export const runtime = "nodejs";

// POST /api/connect/onboard — the owner starts (or resumes) Stripe onboarding.
// Returns a one-time Stripe-hosted onboarding URL for the client to redirect to.
// Owner-only: connecting a bank account is the owner's decision, not a manager's.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

  try {
    const accountId = await ensureConnectAccount(membership.restaurant.id);
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/dashboard/settings?connect=refresh`,
      return_url: `${origin}/dashboard/settings?connect=return`,
      type: "account_onboarding",
    });
    return NextResponse.json({ url: link.url });
  } catch (err) {
    // Most likely the platform hasn't enabled Connect yet
    // (dashboard.stripe.com/connect). Surface a clean message, not a 500.
    console.error("connect onboard error", err);
    return NextResponse.json(
      { error: "Couldn't start Stripe onboarding. Please try again shortly." },
      { status: 502 },
    );
  }
}
