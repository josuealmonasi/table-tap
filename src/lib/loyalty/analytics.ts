// ============================================================================
// What the visit card did over a period, for the owner.
//
// Pure: the page reads the rows, this counts them. Four numbers and one list:
//   - cards made          — diners who said yes
//   - visits stamped      — each one a stamp by somebody on the floor
//   - cards that came back — cards with visits on two or more days in the
//                            period: the thing the card exists to cause
//   - rewards spent
//   - stamps per person   — where a stamp with nothing sold behind it shows
//                           up: one waiter with twice everybody's stamps is
//                           the question worth asking
// ============================================================================

export interface StatCard {
  id: string;
  created_at: string;
}

export interface StatVisit {
  card_id: string;
  visit_day: string;
  actor_email: string;
}

export interface StatRedemption {
  created_at: string;
}

export interface LoyaltyStats {
  cardsMade: number;
  visits: number;
  cameBack: number;
  rewards: number;
  byStaff: { actor: string; stamps: number }[];
}

export function loyaltyStats(
  cards: StatCard[],
  visits: StatVisit[],
  redemptions: StatRedemption[],
): LoyaltyStats {
  const daysByCard = new Map<string, Set<string>>();
  const byActor = new Map<string, number>();
  for (const v of visits) {
    const days = daysByCard.get(v.card_id) ?? new Set<string>();
    days.add(v.visit_day);
    daysByCard.set(v.card_id, days);
    byActor.set(v.actor_email, (byActor.get(v.actor_email) ?? 0) + 1);
  }
  return {
    cardsMade: cards.length,
    visits: visits.length,
    cameBack: [...daysByCard.values()].filter(days => days.size >= 2).length,
    rewards: redemptions.length,
    byStaff: [...byActor.entries()]
      .map(([actor, stamps]) => ({ actor, stamps }))
      .sort((a, b) => b.stamps - a.stamps || a.actor.localeCompare(b.actor)),
  };
}
