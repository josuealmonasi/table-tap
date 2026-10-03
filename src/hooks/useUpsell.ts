"use client";

import { useEffect, useState } from "react";
import type { MenuItem } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import { suggestItems } from "@/lib/suggestions";
import { offeredUpsell, rememberUpsell } from "@/lib/upsell";

/**
 * "Anything else?" — asked on the way to ordering, and asked once.
 *
 * The offer is worked out the first time the cart is opened and then stands
 * for the rest of the bill: same three dishes, still there when the diner
 * comes back from adding something else. Re-running the picks on every visit
 * would reshuffle the strip under their thumb at the worst possible moment,
 * and clearing it on the way out — which is what this used to do — retired
 * the question after a single glance.
 *
 * It retires for real when the diner takes one of them, because a waiter who
 * has been told "yes, and some fries" does not ask again.
 */
export function useUpsell(
  cartOpen: boolean,
  restaurantId: string,
  cartItems: CartItem[],
  items: MenuItem[],
  ratings: Record<string, { avg: number; count: number }>,
): MenuItem[] {
  const [offered, setOffered] = useState<MenuItem[]>([]);
  useEffect(() => {
    if (!cartOpen) return;

    const inCart = new Set(cartItems.map(line => line.itemId));
    const remembered = offeredUpsell(restaurantId);
    if (remembered) {
      // One of them made it into the order: the question has been answered.
      if (remembered.some(id => inCart.has(id))) {
        setOffered([]);
        return;
      }
      const still = remembered
        .map(id => items.find(i => i.id === id))
        .filter((i): i is MenuItem => Boolean(i) && i!.available);
      setOffered(still);
      return;
    }

    const picks = suggestItems({ cart: cartItems, items, ratings });
    if (picks.length === 0) return; // nothing worth suggesting isn't an ask
    rememberUpsell(
      restaurantId,
      picks.map(p => p.id),
    );
    setOffered(picks);
  }, [cartOpen, restaurantId, cartItems, items, ratings]);
  return offered;
}
