/** The restaurant's visit card, as far as a diner needs it to decide. */
export interface LoyaltyOfferInfo {
  restaurantId: string;
  restaurantName: string;
  goal: number;
  reward: string;
}
