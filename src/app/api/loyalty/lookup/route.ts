import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeCode } from "@/lib/loyalty/code";
import { standing } from "@/lib/loyalty/standing";
import { localToday } from "@/lib/loyalty/day";
import { CARD_COLUMNS, cardState, programOf, type CardRow } from "@/lib/loyalty/server";

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
    .select(`${CARD_COLUMNS}, created_at`)
    .eq("restaurant_id", actor.restaurantId)
    .eq("code", code)
    .maybeSingle<CardRow & { created_at: string }>();
  if (!card) return await apiError("apiErr.loyaltyNotHere", 404);

  const program = await programOf(actor.restaurantId);
  const [state, visits, spent, restaurant] = await Promise.all([
    cardState(card, program?.reward ?? ""),
    db.from("loyalty_visits").select("id, visit_day, actor_email, created_at").eq("card_id", card.id)
      .order("visit_day", { ascending: false }).limit(100),
    db.from("loyalty_redemptions").select("reward, actor_email, created_at").eq("card_id", card.id)
      .order("created_at", { ascending: false }).limit(50),
    db.from("restaurants").select("timezone").eq("id", actor.restaurantId).single(),
  ]);
  if (!state) return await apiError("apiErr.generic", 500);
  const today = localToday(restaurant.data?.timezone ?? null);
  // The last reward spent: a visit before it is part of the record that reward
  // was earned on, and `loyalty_unstamp()` refuses to take it back.
  const lastSpent = Math.max(-Infinity, ...(spent.data ?? []).map(r => Date.parse(r.created_at)));

  return NextResponse.json({
    code,
    standing: standing(state.progress, state.ladder, state.done),
    since: card.created_at.slice(0, 10),
    // Only today's may be undone, and not once a reward was spent after it:
    // either way the visit is part of the record. The same rule as
    // `loyalty_unstamp()`, so the screen never offers an undo it refuses.
    visits: (visits.data ?? []).map(v => ({
      id: v.id,
      day: v.visit_day,
      by: v.actor_email,
      undoable: v.visit_day === today && lastSpent < Date.parse(v.created_at),
    })),
    redeemed: (spent.data ?? []).map(r => ({ day: r.created_at.slice(0, 10), reward: r.reward, by: r.actor_email })),
  });
}
