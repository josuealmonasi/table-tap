// ============================================================================
// Where a card stands, for anything that has to say it.
//
// `progress` comes from `loyalty_progress()` — the visits a card has minus the
// visits its rounds spent — the ladder from the card, and `done` from the
// steps already redeemed in the card's current round. Nothing here counts;
// it only words the count, so the scanner, the rewards page and the card cannot
// each work it out a little differently.
// ============================================================================
import type { LadderStep } from "./ladder";

export interface StandingStep extends LadderStep {
  /** Redeemed already this round. */
  done: boolean;
  /** Reached: enough visits for it this round. */
  reached: boolean;
}

export interface Standing {
  /** Visits in the current round, never more than the round shows. */
  visits: number;
  /** The round's length: the last step's visits. */
  goal: number;
  /** Visits still needed for the next reward; zero once it is ready. */
  toGo: number;
  /** The next reward can be redeemed now. */
  ready: boolean;
  /** The next reward to redeem this round — the lowest not yet redeemed. */
  next: LadderStep | null;
  steps: StandingStep[];
}

export function standing(progress: number, ladder: LadderStep[], done: number[] = []): Standing {
  const steps = [...ladder].sort((a, b) => a.visits - b.visits);
  const goal = Math.max(1, steps.length ? steps[steps.length - 1].visits : 1);
  const visits = Math.max(0, Math.floor(progress));
  const next = steps.find(s => !done.includes(s.visits)) ?? null;
  return {
    visits: Math.min(visits, goal),
    goal,
    toGo: next ? Math.max(0, next.visits - visits) : 0,
    ready: next !== null && visits >= next.visits,
    next,
    steps: steps.map(s => ({ ...s, done: done.includes(s.visits), reached: visits >= s.visits })),
  };
}
