"use client";

import { useRef, useState } from "react";
import type { OrderLineItem } from "@/lib/types";

/** A cart line is an order line item plus a client-side id for list keys/removal. */
export type CartItem = OrderLineItem & { cartId: number };

/**
 * Holds the in-progress cart. Money is deliberately NOT computed here — every
 * total comes from priceCart() in src/lib/pricing.ts, so the customer's preview
 * and the server's charge can never drift apart.
 */
export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  // Monotonic id for cart lines — a plain counter can't collide the way
  // Date.now() can when two items are added in the same millisecond.
  const nextId = useRef(1);

  function addItem(line: OrderLineItem) {
    setItems(prev => [...prev, { ...line, cartId: nextId.current++ }]);
  }

  function removeItem(cartId: number) {
    setItems(prev => prev.filter(i => i.cartId !== cartId));
  }

  /** Replaces a line's choices (extras, mods, notes, qty) keeping its place. */
  function updateItem(cartId: number, line: OrderLineItem) {
    setItems(prev => prev.map(i => (i.cartId === cartId ? { ...line, cartId } : i)));
  }

  /** Strips the given extras from every line — used when they sell out at checkout. */
  function removeExtras(extraIds: string[]) {
    const drop = new Set(extraIds);
    setItems(prev =>
      prev.map(line => {
        if (!line.extras?.some(e => drop.has(e.id))) return line;
        const kept = line.extras.filter(e => !drop.has(e.id));
        return { ...line, extras: kept.length ? kept : undefined };
      }),
    );
  }

  function clear() {
    setItems([]);
  }

  const count = items.reduce((sum, i) => sum + i.qty, 0);

  return { items, addItem, removeItem, updateItem, removeExtras, clear, count };
}
