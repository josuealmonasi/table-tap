import { createAdminClient } from "@/lib/supabase/admin";
import { standing } from "./standing";
import type { CardResult } from "./server";
import type { LadderStep } from "./ladder";

export type RedeemResult =
  | (CardResult & { spent: string })
  | { error: "notHere" | "notReady" | "alreadyRedeemed" | "roundChanged" | "invalidRequest" | "failed" };

interface RedemptionSnapshot {
  progress: number;
  goal: number;
  reward: string;
  round_no: number;
  steps: LadderStep[];
  done: number[];
}

/**
 * Spend a card's next reward, once, if it is ready. `step` is the reward the
 * waiter pressed — its visits — and `round` keeps the same step in the next
 * round from being spent by a second tap.
 *
 * Nothing back used to need a second read to tell notHere, alreadyRedeemed
 * or notReady apart. The locked function now answers that question itself:
 * this round or the one just closed cannot change between those reads.
 */
export async function redeem(
  restaurantId: string, code: string, actor: string, step: number, round: number, requestKey: string,
): Promise<RedeemResult> {
  const { data, error } = await createAdminClient().rpc("loyalty_redeem_once", {
    p_restaurant: restaurantId, p_code: code, p_actor: actor,
    p_step: step, p_round: round, p_request_key: requestKey,
  });
  if (error || !data) {
    console.error("loyalty redeem failed:", error?.message);
    return { error: "failed" };
  }
  const row = data as RedemptionSnapshot | Exclude<RedeemResult, CardResult>;
  if ("error" in row) return row;
  // Read the saved answer, never today's standing: a retry after a lost
  // response must still describe the reward that was actually handed over.
  return { standing: standing(row.progress, row.steps, row.done), round: row.round_no, spent: row.reward };
}
