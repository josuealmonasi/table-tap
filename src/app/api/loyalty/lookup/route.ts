import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeCode } from "@/lib/loyalty/code";
import { standing } from "@/lib/loyalty/standing";
import { localToday } from "@/lib/loyalty/day";

export const runtime = "nodejs";

// GET /api/loyalty/lookup?c=… — one of this restaurant's cards, with every
// visit and who stamped it. Owner or manager: this is where a stamp with no
// sale behind it shows up, so it names the staff the diner's page never does.
export async function GET(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const code = normalizeCode(req.nextUrl.searchParams.get("c") ?? "");
  if (!code) return await apiError("rewards.invalid", 400);

  const db = createAdminClient();
  const { data: card } = await db
    .from("loyalty_cards")
    .select("id, goal, created_at")
    .eq("restaurant_id", actor.restaurantId)
    .eq("code", code)
    .maybeSingle();
  if (!card) return await apiError("apiErr.loyaltyNotHere", 404);

  const [progress, visits, spent, restaurant] = await Promise.all([
    db.rpc("loyalty_progress", { p_card: card.id }),
    db.from("loyalty_visits").select("id, visit_day, actor_email").eq("card_id", card.id)
      .order("visit_day", { ascending: false }).limit(100),
    db.from("loyalty_redemptions").select("reward, actor_email, created_at").eq("card_id", card.id)
      .order("created_at", { ascending: false }).limit(50),
    db.from("restaurants").select("timezone").eq("id", actor.restaurantId).single(),
  ]);
  const today = localToday(restaurant.data?.timezone ?? null);

  return NextResponse.json({
    code,
    standing: standing(Number(progress.data ?? 0), card.goal),
    since: card.created_at.slice(0, 10),
    // Only today's may be undone: yesterday's visit is part of the record.
    visits: (visits.data ?? []).map(v => ({ id: v.id, day: v.visit_day, by: v.actor_email, undoable: v.visit_day === today })),
    redeemed: (spent.data ?? []).map(r => ({ day: r.created_at.slice(0, 10), reward: r.reward, by: r.actor_email })),
  });
}
