"use client";

import { useEffect, useMemo, useState } from "react";
import type { MenuItem, Restaurant } from "@/lib/types";
import { priceCart, type AppliedCoupon, type CartPromo } from "@/lib/pricing";
import type { useCart } from "@/hooks/useCart";

/**
 * What the cart comes to: which lines can still be ordered, the tip, the
 * coupon, and one pricing pass over them.
 *
 * /api/checkout runs the same `priceCart` against database prices, so what is
 * shown here is what gets charged.
 */
export function useCartTotals(
  cart: ReturnType<typeof useCart>,
  items: MenuItem[],
  restaurant: Pick<Restaurant, "service_pct" | "service_enabled">,
  promos: CartPromo[],
) {
  // Product ids that sold out at checkout — kept in the cart but greyed out
  // and excluded from the total and the next payment attempt.
  const [soldOut, setSoldOut] = useState<Set<string>>(new Set());
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);

  // When a refresh drops a dish the diner already added, mark it sold out —
  // the same state the checkout would have produced, reached before they are
  // standing at the payment step. Extras live in their own list, so only
  // products are judged here.
  const liveIds = useMemo(() => new Set(items.map(i => i.id)), [items]);
  useEffect(() => {
    const gone = cart.items
      .filter(line => !line.comboId && !liveIds.has(line.itemId))
      .map(line => line.itemId);
    if (gone.length === 0) return;
    setSoldOut(prev => {
      if (gone.every(id => prev.has(id))) return prev;
      const next = new Set(prev);
      gone.forEach(id => next.add(id));
      return next;
    });
  }, [cart.items, liveIds]);

  const orderableItems = useMemo(
    () => cart.items.filter(i => !soldOut.has(i.itemId)),
    [cart.items, soldOut],
  );

  const pricing = useMemo(
    () =>
      priceCart({
        items: orderableItems,
        servicePct: restaurant.service_pct,
        serviceEnabled: restaurant.service_enabled,
        tipPct,
        tipAmount: tipCustom,
        coupon,
        promos,
      }),
    [
      orderableItems,
      restaurant.service_pct,
      restaurant.service_enabled,
      tipPct,
      tipCustom,
      coupon,
      promos,
    ],
  );

  function markSoldOut(itemId: string): void {
    setSoldOut(prev => new Set(prev).add(itemId));
  }

  /** A preset percentage clears an exact amount. */
  function choosePct(pct: number): void {
    setTipPct(pct);
    setTipCustom(null);
  }

  return {
    soldOut,
    markSoldOut,
    orderableItems,
    pricing,
    tipPct,
    choosePct,
    tipCustom,
    setTipCustom,
    coupon,
    setCoupon,
  };
}
