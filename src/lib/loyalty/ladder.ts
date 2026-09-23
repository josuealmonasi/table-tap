// ============================================================================
// The reward ladder: several rewards on one card, each once per round.
//
// 4 visits a coffee, 8 a dessert, 12 a meal. The last step's visits are the
// round: redeeming it spends them and the card starts over, extra visits
// carrying across. A step in the middle spends none. Rewards are redeemed in
// order, so a diner who reaches 12 having skipped the coffee still gets it —
// nothing earned is lost.
//
// Client-safe: the form that edits a ladder and the route that saves it check
// it with the same function, and `loyalty_redeem()` applies the same rule.
// ============================================================================
import { GOAL_MAX, GOAL_MIN, REWARD_MAX } from "./rules";

export interface LadderStep {
  visits: number;
  reward: string;
}

/** How many rewards one card may carry. More reads as a price list, not a card. */
export const STEPS_MAX = 4;

/**
 * A row's ladder: its steps, or — for anything saved before the ladder — the
 * one-step ladder its goal and reward make.
 */
export function ladderOf(steps: unknown, goal: number, reward: string): LadderStep[] {
  if (Array.isArray(steps) && steps.length > 0) {
    return steps
      .map(s => ({ visits: Number((s as LadderStep)?.visits), reward: String((s as LadderStep)?.reward ?? "") }))
      .filter(s => Number.isInteger(s.visits) && s.visits > 0)
      .sort((a, b) => a.visits - b.visits);
  }
  return [{ visits: goal, reward }];
}

export type LadderCheck = { steps: LadderStep[] } | { error: string; vars?: Record<string, number> };

/** A ladder somebody typed: cleaned and sorted, or the key of what is wrong with it. */
export function checkLadder(raw: unknown): LadderCheck {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "apiErr.loyaltyRewardNeeded" };
  if (raw.length > STEPS_MAX) return { error: "apiErr.loyaltySteps", vars: { max: STEPS_MAX } };
  const steps: LadderStep[] = [];
  for (const item of raw) {
    const visits = (item as LadderStep | null)?.visits;
    const rawReward = (item as LadderStep | null)?.reward;
    if (typeof visits !== "number" || !Number.isInteger(visits) || visits < GOAL_MIN || visits > GOAL_MAX) {
      return { error: "apiErr.loyaltyGoal", vars: { min: GOAL_MIN, max: GOAL_MAX } };
    }
    if (typeof rawReward !== "string" && rawReward !== undefined) return { error: "apiErr.invalidRequest" };
    const reward = (rawReward ?? "").trim();
    if (!reward) return { error: raw.length === 1 ? "apiErr.loyaltyRewardNeeded" : "apiErr.loyaltyStepReward" };
    if (reward.length > REWARD_MAX) return { error: "apiErr.loyaltyReward", vars: { max: REWARD_MAX } };
    steps.push({ visits, reward });
  }
  steps.sort((a, b) => a.visits - b.visits);
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].visits === steps[i - 1].visits) return { error: "apiErr.loyaltyStepsRepeat" };
  }
  return { steps };
}

export type ProgramCheck =
  | { steps: LadderStep[]; goal: number; reward: string }
  | { error: string; vars?: Record<string, number> };

/**
 * A program as the owner saves it. Switched on, it needs a whole ladder. Off,
 * it may also be just a number of visits with no reward yet — the state a
 * program is in before anybody has decided what it gives — which is saved as
 * no ladder at all, so no card can ever be made from it.
 */
export function checkProgram(active: boolean, raw: unknown): ProgramCheck {
  const only = Array.isArray(raw) && raw.length === 1 ? (raw[0] as LadderStep | null) : null;
  if (!active && only && (only.reward === undefined || (typeof only.reward === "string" && only.reward.trim() === ""))) {
    const visits = only.visits;
    if (typeof visits !== "number" || !Number.isInteger(visits) || visits < GOAL_MIN || visits > GOAL_MAX) {
      return { error: "apiErr.loyaltyGoal", vars: { min: GOAL_MIN, max: GOAL_MAX } };
    }
    return { steps: [], goal: visits, reward: "" };
  }
  const checked = checkLadder(raw);
  if ("error" in checked) return checked;
  const last = checked.steps[checked.steps.length - 1];
  return { steps: checked.steps, goal: last.visits, reward: last.reward };
}

/** "4 visits = Coffee", one per step, worded by whoever shows them. */
export function ladderLines(
  steps: LadderStep[],
  t: (key: string, vars?: Record<string, string | number>) => string,
): string[] {
  return steps.map(s =>
    s.reward.trim()
      ? t("loyaltyOffer.cardReward", { goal: s.visits, reward: s.reward.trim() })
      : t("loyaltyOffer.cardGoal", { goal: s.visits }),
  );
}
