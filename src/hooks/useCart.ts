"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderLineItem } from "@/lib/types";

/** A cart line is an order line item plus a client-side id for list keys/removal. */
export type CartItem = OrderLineItem & { cartId: number };

const storageKey = (restaurantId: string) => `tt-cart:${restaurantId}`;

/**
 * Holds the in-progress cart. Money is deliberately NOT computed here — every
 * total comes from priceCart() in src/lib/pricing.ts, so the customer's preview
 * and the server's charge can never drift apart.
 *
 * The cart survives a reload. A diner reading a menu on a phone at a table
 * will lock the screen, follow a link, or lose the tab, and losing a
 * half-built order to that is the kind of thing that ends the order entirely.
 * Kept per restaurant so one venue's cart can't surface at another's table.
 *
 * What's stored is only what the diner chose — names and prices come back from
 * the database at checkout, so a tampered cart buys nothing.
 */
export function useCart(restaurantId: string) {
  const [items, setItems] = useState<CartItem[]>([]);
  // Until the stored cart has been read, writing would persist an empty array
  // over it — this gates the save effect until the first read has happened.
  const [restored, setRestored] = useState(false);
  // Monotonic id for cart lines — a plain counter can't collide the way
  // Date.now() can when two items are added in the same millisecond.
  const nextId = useRef(1);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(restaurantId));
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        const lines = parsed.filter(
          (l): l is CartItem =>
            typeof l === "object" && l !== null && typeof (l as CartItem).itemId === "string",
        );
        setItems(lines);
        // Continue the counter past anything restored, or a new line would
        // collide with a stored one and the wrong row would be removed.
        nextId.current = lines.reduce((max, l) => Math.max(max, l.cartId ?? 0), 0) + 1;
      }
    } catch {
      // Corrupt or unavailable storage just means an empty cart, never a throw.
    }
    setRestored(true);
  }, [restaurantId]);

  useEffect(() => {
    if (!restored) return;
    try {
      if (items.length === 0) localStorage.removeItem(storageKey(restaurantId));
      else localStorage.setItem(storageKey(restaurantId), JSON.stringify(items));
    } catch {
      // Private mode: the cart still works for this session.
    }
  }, [items, restored, restaurantId]);

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
