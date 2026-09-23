import type { LadderStep } from "@/lib/loyalty/ladder";

/** The restaurant's visit card, as far as a diner needs it to decide. */
export interface LoyaltyOfferInfo {
  restaurantId: string;
  restaurantName: string;
  /** The round's length: the last step's visits. */
  goal: number;
  /** The last step's reward. */
  reward: string;
  /** Every reward on the card, in order of visits. */
  steps: LadderStep[];
}
