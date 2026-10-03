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
  /** What the card route takes as proof the offer came from inside the
   *  restaurant (`src/lib/loyalty/pass.ts`). One pass makes one card. */
  pass: string;
}
