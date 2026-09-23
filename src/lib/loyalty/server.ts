// ============================================================================
// Stamping and redeeming, for the routes that let staff do it.
//
// SERVER-ONLY: reads with the secret key. Whether the scanner is shown and
// whether a stamp is taken are the same question, answered here once — a
// screen that offered "Sellar tarjeta" to a restaurant whose program is off
// would be offering a button the route then refuses, the app's oldest bug.
// ============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { can, type PlanLimits } from "@/lib/plan";
import { standing, type Standing } from "@/lib/loyalty/standing";

export interface LoyaltyProgram {
  active: boolean;
  goal: number;
  reward: string;
}

/** The restaurant's program, or null when it has never set one up. */
export async function programOf(restaurantId: string): Promise<LoyaltyProgram | null> {
  const { data } = await createAdminClient()
    .from("loyalty_programs")
    .select("active, goal, reward")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return data ?? null;
}

/** Whether staff may stamp cards here right now: the plan has it and it is on. */
export async function loyaltyOn(restaurantId: string, limits: PlanLimits | null): Promise<boolean> {
  if (!limits || !can(limits, "loyalty")) return false;
  return (await programOf(restaurantId))?.active === true;
}

export interface CardResult {
  standing: Standing;
  reward: string;
}

export type StampResult = (CardResult & { stamped: boolean }) | { error: "notHere" | "failed" };

/**
 * Today's visit on a card, for this restaurant only.
 *
 * `stamped: false` is not a failure: the card already has today's visit, and
 * saying so is the answer. The database function refuses a card of another
 * restaurant's by returning nothing, which is the one case worth an error.
 */
export async function stamp(restaurantId: string, code: string, actor: string): Promise<StampResult> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("loyalty_stamp", {
    p_restaurant: restaurantId,
    p_code: code,
    p_actor: actor,
  });
  if (error) {
    console.error("loyalty stamp failed:", error.message);
    return { error: "failed" };
  }
  const row = (data as { progress: number; goal: number; stamped: boolean }[] | null)?.[0];
  if (!row) return { error: "notHere" };
  const program = await programOf(restaurantId);
  return { standing: standing(row.progress, row.goal), reward: program?.reward ?? "", stamped: row.stamped };
}

export type RedeemResult = (CardResult & { spent: string }) | { error: "notHere" | "notReady" | "failed" };

/** Spend a ready card's reward, once. */
export async function redeem(restaurantId: string, code: string, actor: string): Promise<RedeemResult> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("loyalty_redeem", {
    p_restaurant: restaurantId,
    p_code: code,
    p_actor: actor,
  });
  if (error) {
    console.error("loyalty redeem failed:", error.message);
    return { error: "failed" };
  }
  const row = (data as { progress: number; goal: number; reward: string }[] | null)?.[0];
  if (row) {
    const program = await programOf(restaurantId);
    return { standing: standing(row.progress, row.goal), reward: program?.reward ?? "", spent: row.reward };
  }
  // Nothing back: either the card is not this restaurant's, or it is and has
  // not reached its goal. Which one decides what the waiter is told.
  const { data: card } = await db
    .from("loyalty_cards")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("code", code)
    .maybeSingle();
  return { error: card ? "notReady" : "notHere" };
}
