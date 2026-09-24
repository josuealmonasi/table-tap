// ============================================================================
// Everything a loyalty card shows, in one place.
//
// Today a card is an image the diner saves. Later it can be an Apple Wallet
// pass or a Google Wallet object. Each of those is a way of DRAWING a card;
// none of them is a different card. So what a card says is decided here once —
// its name, its mark, its progress, its rewards, its code and where its QR
// points — and every presentation draws from this, never from the database
// directly. Adding a wallet then means writing one more drawer, and the card a
// waiter scans, the page a diner checks and the visits already earned stay
// exactly as they are.
// ============================================================================
import { formatCode, rewardsLink } from "@/lib/loyalty/code";
import type { LadderStep } from "@/lib/loyalty/ladder";
import { standing, type Standing } from "@/lib/loyalty/standing";

export interface FaceRestaurant {
  name: string;
  logo: string | null;
  logo_url: string | null;
}

export interface FaceCard {
  code: string;
  progress: number;
  /** The card's own ladder: the one its round started with. */
  ladder: LadderStep[];
  /** Steps already redeemed this round. */
  done?: number[];
}

export interface CardFace {
  restaurantName: string;
  /** An uploaded mark takes precedence; the emoji is the fallback. */
  logoUrl: string | null;
  logoEmoji: string | null;
  /** As printed: K7QM-3XW9-TB4R. */
  printedCode: string;
  /** What the QR carries — the same for every presentation. */
  qrPayload: string;
  /** Where the card stands, its rewards included. */
  standing: Standing;
}

export function cardFace(restaurant: FaceRestaurant, card: FaceCard, origin: string): CardFace {
  return {
    restaurantName: restaurant.name,
    logoUrl: restaurant.logo_url || null,
    logoEmoji: restaurant.logo_url ? null : restaurant.logo || null,
    printedCode: formatCode(card.code),
    qrPayload: rewardsLink(origin, card.code),
    standing: standing(
      card.progress,
      card.ladder.map(s => ({ visits: s.visits, reward: s.reward.trim() })),
      card.done ?? [],
    ),
  };
}
