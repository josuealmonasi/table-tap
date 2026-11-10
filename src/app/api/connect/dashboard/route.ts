import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { createDashboardLink, readConnect } from "@/lib/stripe-connect";

export const runtime = "nodejs";

// POST /api/connect/dashboard — a one-time link into the restaurant's own
// Stripe dashboard: payouts, the bank they land in, disputes (E5). Owner-only,
// like connecting the account in the first place.
export async function POST() {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  try {
    const { accountId } = await readConnect(actor.restaurantId);
    if (!accountId) return await apiError("apiErr.connectFirst", 409);
    return NextResponse.json({ url: await createDashboardLink(accountId) });
  } catch (err) {
    console.error("connect dashboard error", err);
    return await apiError("apiErr.stripeDashboard", 502);
  }
}
