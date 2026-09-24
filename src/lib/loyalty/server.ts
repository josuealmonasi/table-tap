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
import { ladderOf, type LadderStep } from "@/lib/loyalty/ladder";

export interface LoyaltyProgram {
  active: boolean;
  /** The round's length: the last step's visits. */
  goal: number;
  /** The last step's reward. */
  reward: string;
  /** Never empty: a program saved before the ladder is its one step. */
  steps: LadderStep[];
}

/** The restaurant's program, or null when it has never set one up. */
export async function programOf(restaurantId: string): Promise<LoyaltyProgram | null> {
  const { data } = await createAdminClient()
    .from("loyalty_programs")
    .select("active, goal, reward, steps")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!data) return null;
  return { active: data.active, goal: data.goal, reward: data.reward, steps: ladderOf(data.steps, data.goal, data.reward) };
}

/** What a card's standing is worked out from. */
export const CARD_COLUMNS = "id, goal, steps, round_no";

export interface CardRow {
  id: string;
  goal: number;
  steps: unknown;
  round_no: number;
}

export interface CardState {
  progress: number;
  ladder: LadderStep[];
  /** The steps redeemed in the card's current round. */
  done: number[];
}

/**
 * A card's progress, its ladder and what it has redeemed this round — the
 * three things every screen that shows a card needs. `programReward` is only
 * for a card from before the ladder, whose one step is its goal and the
 * program's reward. Null when a read fails: a card is never shown on a guess.
 */
export async function cardState(card: CardRow, programReward: string): Promise<CardState | null> {
  const db = createAdminClient();
  const [progress, done] = await Promise.all([
    db.rpc("loyalty_progress", { p_card: card.id }),
    db.from("loyalty_redemptions").select("step").eq("card_id", card.id).eq("round_no", card.round_no),
  ]);
  if (progress.error || done.error) {
    console.error("loyalty card read failed:", (progress.error ?? done.error)?.message);
    return null;
  }
  return {
    progress: Number(progress.data ?? 0),
    ladder: ladderOf(card.steps, card.goal, programReward),
    done: (done.data ?? []).flatMap(r => (typeof r.step === "number" ? [r.step] : [])),
  };
}

/**
 * Where a card stands after a stamp or a redemption the database has already
 * made. If the card cannot be read back, the count the database answered with
 * is still true — only the name of the next reward is missing — and saying it
 * failed would be worse: a waiter told a redemption failed taps again, and the
 * second tap spends the NEXT reward.
 */
async function standingAfter(
  restaurantId: string,
  code: string,
  answered: { progress: number; goal: number },
): Promise<Standing> {
  return (
    (await standingNow(restaurantId, code)) ??
    standing(answered.progress, [{ visits: answered.goal, reward: "" }])
  );
}

/** One of this restaurant's cards, where it stands now. */
async function standingNow(restaurantId: string, code: string): Promise<Standing | null> {
  const { data: card, error } = await createAdminClient()
    .from("loyalty_cards")
    .select(CARD_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("code", code)
    .maybeSingle();
  if (error || !card) return null;
  const program = await programOf(restaurantId);
  const state = await cardState(card, program?.reward ?? "");
  return state ? standing(state.progress, state.ladder, state.done) : null;
}

/** Whether staff may stamp cards here right now: the plan has it and it is on. */
export async function loyaltyOn(restaurantId: string, limits: PlanLimits | null): Promise<boolean> {
  if (!limits || !can(limits, "loyalty")) return false;
  return (await programOf(restaurantId))?.active === true;
}

export interface CardResult {
  /** Its rewards included: the next one is `standing.next`. */
  standing: Standing;
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
  return { standing: await standingAfter(restaurantId, code, row), stamped: row.stamped };
}

export type RedeemResult =
  | (CardResult & { spent: string })
  | { error: "notHere" | "notReady" | "alreadyRedeemed" | "failed" };

/**
 * Spend a card's next reward, once, if it is ready. `step` is the reward the
 * waiter pressed — its visits — so a second tap on the same button cannot
 * spend the reward after it.
 */
export async function redeem(restaurantId: string, code: string, actor: string, step: number | null): Promise<RedeemResult> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("loyalty_redeem", {
    p_restaurant: restaurantId,
    p_code: code,
    p_actor: actor,
    p_step: step,
  });
  if (error) {
    console.error("loyalty redeem failed:", error.message);
    return { error: "failed" };
  }
  const row = (data as { progress: number; goal: number; reward: string }[] | null)?.[0];
  if (row) return { standing: await standingAfter(restaurantId, code, row), spent: row.reward };
  // Nothing back: the card is not this restaurant's, or the reward pressed was
  // spent already this round (the other tap won), or the next one is not
  // ready. Which one decides what the waiter is told.
  const { data: card } = await db
    .from("loyalty_cards")
    .select("id, round_no")
    .eq("restaurant_id", restaurantId)
    .eq("code", code)
    .maybeSingle();
  if (!card) return { error: "notHere" };
  if (step !== null) {
    // This round or the one just closed: a second tap on the last reward finds
    // the round it closed, not the new one.
    const { count } = await db
      .from("loyalty_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("card_id", card.id)
      .in("round_no", [card.round_no, card.round_no - 1])
      .eq("step", step);
    if ((count ?? 0) > 0) return { error: "alreadyRedeemed" };
  }
  return { error: "notReady" };
}
