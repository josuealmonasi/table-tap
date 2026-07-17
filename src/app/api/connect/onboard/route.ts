import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import { createOnboardingLink, ensureConnectAccount } from "@/lib/stripe-connect";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    return NextResponse.json(
      { error: "Couldn't start Stripe onboarding. Please try again shortly." },
      { status: 502 },
    );
  }
}
