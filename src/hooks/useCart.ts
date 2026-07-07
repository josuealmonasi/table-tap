"use client";

import { useMemo, useState } from "react";
import { lineUnitPrice, type OrderLineItem, type Restaurant } from "@/lib/types";

/** A cart line is an order line item plus a client-side id for list keys/removal. */
export type CartItem = OrderLineItem & { cartId: number };

/**
 * Holds the in-progress cart and derives its money totals from the
 * restaurant's service charge. The single source of truth for cart state.
 */
export function useCart(restaurant: Restaurant) {
  const [items, setItems] = useState<CartItem[]>([]);

  function addItem(line: OrderLineItem) {
    setItems((prev) => [...prev, { ...line, cartId: Date.now() }]);
  }

  function removeItem(cartId: number) {
    setItems((prev) => prev.filter((i) => i.cartId !== cartId));
  }

  /** Removes every line for a product — used when it becomes unavailable at checkout. */
  function removeByItemId(itemId: string) {
    setItems((prev) => prev.filter((i) => i.itemId !== itemId));
  }

  function clear() {
    setItems([]);
  }

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, i) => sum + lineUnitPrice(i) * i.qty, 0);
    const serviceFee = +(subtotal * (restaurant.service_pct / 100)).toFixed(2);
    return { subtotal, serviceFee, total: subtotal + serviceFee };
  }, [items, restaurant.service_pct]);

  const count = items.reduce((sum, i) => sum + i.qty, 0);

  return { items, addItem, removeItem, removeByItemId, clear, count, ...totals };
}
