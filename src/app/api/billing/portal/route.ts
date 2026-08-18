import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// POST /api/billing/portal — Stripe's own billing page.
//
// Changing a card, downloading receipts and cancelling all live there rather
// than being rebuilt here: it is where the card details already are, and every
// one of those screens is a place to get card handling wrong.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { data } = await createAdminClient()
    .from("restaurants")
    .select("stripe_customer_id")
    .eq("id", actor.restaurantId)
    .single();

  const customerId = data?.stripe_customer_id as string | null;
  if (!customerId) return await apiError("apiErr.noBilling", 400);

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard`,
  });

  return NextResponse.json({ url: session.url });
}
