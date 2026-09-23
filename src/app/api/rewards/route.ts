import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { normalizeCode } from "@/lib/loyalty/code";
import { standing } from "@/lib/loyalty/standing";

export const runtime = "nodejs";

// GET /api/rewards?c=K7QM3XW9TB4R — where a loyalty card stands, for whoever
// holds it. Public: the card is the only key there is, the way a gift card is.
//
// It answers with what the card itself would show and nothing more — the
// restaurant, the progress, the reward, the days of the last visit and of each
// reward spent. Never who stamped it, never the card's internal id.
export async function GET(req: NextRequest) {
  // Sixty bits cannot be walked, but a page that answers "no such card" as fast
  // as it is asked is still an oracle. Ten looks a minute is plenty for a
  // person with a card in their hand.
  if (await isRateLimited(`rewards:${clientIp(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  const code = normalizeCode(req.nextUrl.searchParams.get("c") ?? "");
  if (!code) return await apiError("rewards.invalid", 400);

  const db = createAdminClient();
  const { data: card, error } = await db
    .from("loyalty_cards")
    .select("id, restaurant_id, goal, created_at")
    .eq("code", code)
    .maybeSingle();
  if (error) {
    console.error("rewards: card read failed:", error.message);
    return await apiError("apiErr.generic", 500);
  }
  if (!card) return await apiError("rewards.notFound", 404);

  const [restaurant, program, progress, lastVisit, spent] = await Promise.all([
    db.from("restaurants").select("name, logo, logo_url").eq("id", card.restaurant_id).single(),
    db.from("loyalty_programs").select("active, reward").eq("restaurant_id", card.restaurant_id).maybeSingle(),
    db.rpc("loyalty_progress", { p_card: card.id }),
    db.from("loyalty_visits").select("visit_day").eq("card_id", card.id)
      .order("visit_day", { ascending: false }).limit(1).maybeSingle(),
    db.from("loyalty_redemptions").select("reward, created_at").eq("card_id", card.id)
      .order("created_at", { ascending: false }).limit(20),
  ]);
  const failed = [restaurant, program, progress, lastVisit, spent].find(r => r.error);
  if (failed?.error || !restaurant.data) {
    console.error("rewards: read failed:", failed?.error?.message ?? "no restaurant");
    return await apiError("apiErr.generic", 500);
  }

  return NextResponse.json({
    restaurant: restaurant.data,
    // Paused means no new visits, not that the card stopped meaning anything:
    // a reward already earned is still honoured.
    active: program.data?.active ?? false,
    reward: program.data?.reward ?? "",
    standing: standing(Number(progress.data ?? 0), card.goal),
    memberSince: card.created_at.slice(0, 10),
    lastVisit: lastVisit.data?.visit_day ?? null,
    redeemed: (spent.data ?? []).map(r => ({ day: r.created_at.slice(0, 10), reward: r.reward })),
  });
}
