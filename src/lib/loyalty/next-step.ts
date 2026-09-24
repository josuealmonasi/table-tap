// ============================================================================
// The one sentence about what a card needs next.
//
// The diner's rewards page and the staff scanner both count down with it, and
// they must count the same: a diner told "1 more visit" at the table and
// "ready" on their phone has been told two different things by one system.
// Once a card is ready the two part ways on purpose — the diner is told to
// show their card, the staff are handed the button that redeems it.
//
// The reward named is always the NEXT one on the ladder: rewards are redeemed
// in order, so that is the one the next visit, or the next tap, is about.
// ============================================================================
import type { Standing } from "@/lib/loyalty/standing";

export interface Sentence {
  key: string;
  vars?: Record<string, string | number>;
}

export function nextStep(s: Standing): Sentence {
  const r = (s.next?.reward ?? "").trim();
  if (s.ready) return r ? { key: "rewards.readyHint", vars: { reward: r } } : { key: "rewards.readyHintNoReward" };
  if (r) return { key: s.toGo === 1 ? "rewards.toGoOne" : "rewards.toGo", vars: { n: s.toGo, reward: r } };
  return { key: s.toGo === 1 ? "rewards.toGoOneNoReward" : "rewards.toGoNoReward", vars: { n: s.toGo } };
}
