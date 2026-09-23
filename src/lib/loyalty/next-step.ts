// ============================================================================
// The one sentence about what a card needs next.
//
// The diner's rewards page and the staff scanner both say it, and they must
// say the same thing: a diner told "1 more visit" at the table and "ready" on
// their phone has been told two different things by one system.
// ============================================================================
import type { Standing } from "@/lib/loyalty/standing";

export interface Sentence {
  key: string;
  vars?: Record<string, string | number>;
}

export function nextStep(s: Standing, reward: string): Sentence {
  const r = reward.trim();
  if (s.ready) return r ? { key: "rewards.readyHint", vars: { reward: r } } : { key: "rewards.readyHintNoReward" };
  if (r) return { key: s.toGo === 1 ? "rewards.toGoOne" : "rewards.toGo", vars: { n: s.toGo, reward: r } };
  return { key: s.toGo === 1 ? "rewards.toGoOneNoReward" : "rewards.toGoNoReward", vars: { n: s.toGo } };
}
