"use client";

import { useEffect, useRef, useState } from "react";
import type { CartItem } from "@/hooks/useCart";
import type { OrderLineItem } from "@/lib/types";

/**
 * The sale being rung up at the till.
 *
 * A half-rung sale survives a reload. A counter is the worst place to lose
 * one: the customer is standing there, the cashier has already read six items
 * back to them, and a stray refresh or a tablet reloading itself meant
 * starting the whole order again. Nothing of this reaches the server — it is
 * the same cart, on the same device, waiting to be charged.
 */
export function usePosCart(restaurantId: string) {
  const [lines, setLines] = useState<CartItem[]>([]);
  const [restored, setRestored] = useState(false);
  const nextCartId = useRef(1);
  const storageKey = `tt-pos-cart:${restaurantId}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLines(parsed as CartItem[]);
          nextCartId.current =
            Math.max(0, ...(parsed as CartItem[]).map(l => l.cartId ?? 0)) + 1;
        }
      }
    } catch {
      // A browser that will not give us storage still sells; it just cannot
      // hold a sale across a reload.
    }
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    // Not before the restore has run, or an empty first render would wipe it.
    if (!restored) return;
    try {
      if (lines.length === 0) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(lines));
    } catch {
      // Nothing to do, and nothing worth interrupting a sale for.
    }
  }, [lines, restored, storageKey]);

  function add(line: OrderLineItem): void {
    setLines(prev => [...prev, { ...line, cartId: nextCartId.current++ }]);
  }

  /** A line edited on the dish screen, kept in its place. */
  function replace(cartId: number, line: OrderLineItem): void {
    setLines(prev =>
      prev.map(l => (l.cartId === cartId ? { ...line, cartId: l.cartId } : l)),
    );
  }

  function changeQty(cartId: number, qty: number): void {
    setLines(prev =>
      qty <= 0
        ? prev.filter(l => l.cartId !== cartId)
        : prev.map(l => (l.cartId === cartId ? { ...l, qty: Math.min(qty, 99) } : l)),
    );
  }

  return { lines, add, replace, changeQty, clear: () => setLines([]) };
}
