import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingStaff } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { badgesFor } from "@/lib/badges";

export const dynamic = "force-dynamic";

/**
 * GET /api/badges — what this person's sections are waiting on.
 *
 * Counted server-side and scoped to the caller's role, so a waiter is never
 * sent a number of approvals they cannot act on — the rule that decides what
 * they may see is not something a browser should be trusted to apply.
 */
export async function GET(): Promise<NextResponse> {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const db = createAdminClient();
  const { data: restaurant } = await db
    .from("restaurants")
    .select("badges_enabled")
    .eq("id", actor.restaurantId)
    .maybeSingle();

  // Switched off for the restaurant means switched off for everyone in it.
  if (restaurant && (restaurant as { badges_enabled: boolean }).badges_enabled === false) {
    return NextResponse.json({ badges: {} });
  }

  const [orders, discounts, writeOffs] = await Promise.all([
    db
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", actor.restaurantId)
      .in("status", ["received", "preparing"]),
    db
      .from("discount_requests")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", actor.restaurantId)
      .eq("status", "pending"),
    db
      .from("write_off_requests")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", actor.restaurantId)
      .eq("status", "pending"),
  ]);

  return NextResponse.json({
    badges: badgesFor(actor.role, {
      orders: orders.count ?? 0,
      approvals: (discounts.count ?? 0) + (writeOffs.count ?? 0),
    }),
  });
}
