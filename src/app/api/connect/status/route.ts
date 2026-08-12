import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { syncConnectStatus } from "@/lib/stripe-connect";

export const runtime = "nodejs";

// GET /api/connect/status — owner-only. Returns the restaurant's live Stripe
// account state (also syncing stripe_charges_enabled in the DB), so the
// Payments card can show whether the restaurant can take orders yet.
export async function GET() {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const status = await syncConnectStatus(actor.restaurantId);
  return NextResponse.json({
    connected: Boolean(status.accountId),
    chargesEnabled: status.chargesEnabled,
    detailsSubmitted: status.detailsSubmitted,
  });
}
