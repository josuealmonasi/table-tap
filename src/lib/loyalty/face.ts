// ============================================================================
// Everything a loyalty card shows, in one place.
//
// Today a card is an image the diner saves. Later it can be an Apple Wallet
// pass or a Google Wallet object. Each of those is a way of DRAWING a card;
// none of them is a different card. So what a card says is decided here once —
// its name, its mark, its progress, its code and where its QR points — and
// every presentation draws from this, never from the database directly. Adding
// a wallet then means writing one more drawer, and the card a waiter scans,
// the page a diner checks and the visits already earned stay exactly as they
// are.
// ============================================================================
import { formatCode, rewardsLink } from "@/lib/loyalty/code";
import { standing, type Standing } from "@/lib/loyalty/standing";

export interface FaceRestaurant {
  name: string;
  logo: string | null;
  logo_url: string | null;
}

export interface FaceProgram {
  reward: string;
}

export interface FaceCard {
  code: string;
  goal: number;
  progress: number;
}

export interface CardFace {
  restaurantName: string;
  /** An uploaded mark takes precedence; the emoji is the fallback. */
  logoUrl: string | null;
  logoEmoji: string | null;
  reward: string;
  /** As printed: K7QM-3XW9-TB4R. */
  printedCode: string;
  /** What the QR carries — the same for every presentation. */
  qrPayload: string;
  standing: Standing;
}

export function cardFace(
  restaurant: FaceRestaurant,
  program: FaceProgram,
  card: FaceCard,
  origin: string,
): CardFace {
  return {
    restaurantName: restaurant.name,
    logoUrl: restaurant.logo_url || null,
    logoEmoji: restaurant.logo_url ? null : restaurant.logo || null,
    reward: program.reward.trim(),
    printedCode: formatCode(card.code),
    qrPayload: rewardsLink(origin, card.code),
    standing: standing(card.progress, card.goal),
  };
}
