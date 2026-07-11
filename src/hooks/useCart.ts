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

  /** Replaces a line's choices (extras, mods, notes, qty) keeping its place. */
  function updateItem(cartId: number, line: OrderLineItem) {
    setItems((prev) => prev.map((i) => (i.cartId === cartId ? { ...line, cartId } : i)));
  }

  /** Strips the given extras from every line — used when they sell out at checkout. */
  function removeExtras(extraIds: string[]) {
    const drop = new Set(extraIds);
    setItems((prev) =>
      prev.map((line) => {
        if (!line.extras?.some((e) => drop.has(e.id))) return line;
        const kept = line.extras.filter((e) => !drop.has(e.id));
        return { ...line, extras: kept.length ? kept : undefined };
      })
    );
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

  return { items, addItem, removeItem, updateItem, removeExtras, clear, count, ...totals };
}
