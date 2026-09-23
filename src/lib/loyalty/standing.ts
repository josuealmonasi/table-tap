// ============================================================================
// Where a card stands, for anything that has to say it.
//
// `progress` comes from `loyalty_progress()` — the visits a card has minus the
// visits its rewards used — and `goal` from the card itself. Nothing here
// counts; it only words the count, so the scanner, the rewards page and the
// card cannot each work it out a little differently.
// ============================================================================

export interface Standing {
  /** Visits towards the current reward, never more than the goal shows. */
  visits: number;
  goal: number;
  /** Visits still needed; zero once the reward is ready. */
  toGo: number;
  ready: boolean;
}

export function standing(progress: number, goal: number): Standing {
  const visits = Math.max(0, Math.floor(progress));
  const safeGoal = Math.max(1, Math.floor(goal));
  return {
    visits: Math.min(visits, safeGoal),
    goal: safeGoal,
    toGo: Math.max(0, safeGoal - visits),
    ready: visits >= safeGoal,
  };
}
