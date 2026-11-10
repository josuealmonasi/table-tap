"use client";

import { plainTwin } from "@/lib/pos-quick";
import { useEffect, useRef, useState } from "react";
import type { CartItem } from "@/hooks/useCart";
import type { OrderLineItem } from "@/lib/types";

/**
 * The sale being rung up at the till — or the round a waiter is writing down.
 *
 * A half-rung sale survives a reload. A counter is the worst place to lose
 * one: the customer is standing there, the cashier has already read six items
 * back to them, and a stray refresh or a tablet reloading itself meant
 * starting the whole order again. Nothing of this reaches the server — it is
 * the same cart, on the same device, waiting to be charged.
 *
 * `remember` false keeps it in memory only: the waiter's pad never kept one,
 * and sharing the till's key would put a waiter's round on the till of the
 * same device.
 */
export function usePosCart(restaurantId: string, remember = true) {
  const [lines, setLines] = useState<CartItem[]>([]);
  const [restored, setRestored] = useState(false);
  const nextCartId = useRef(1);
  const storageKey = `tt-pos-cart:${restaurantId}`;

  useEffect(() => {
    if (!remember) return;
    try {
      // A sale was being charged when the page went away. The held receipt is
      // now the record of that money and replays itself; restoring its lines
      // too offered the same food to charge again under a new reference (C1).
      if (localStorage.getItem(`${storageKey}:charging`)) {
        localStorage.removeItem(`${storageKey}:charging`);
        localStorage.removeItem(storageKey);
      }
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
  }, [storageKey, remember]);

  useEffect(() => {
    // Not before the restore has run, or an empty first render would wipe it.
    if (!remember || !restored) return;
    try {
      if (lines.length === 0) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(lines));
    } catch {
      // Nothing to do, and nothing worth interrupting a sale for.
    }
  }, [lines, restored, storageKey, remember]);

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

  /**
   * One tap of a dish with nothing to choose: one more of it. A plain line of
   * the same dish already in the sale grows, so three lattes read as "3 ×"
   * rather than three lines to scan on the ticket.
   */
  function addOne(line: OrderLineItem): void {
    setLines(prev => {
      const twin = plainTwin(prev, line.itemId);
      if (!twin) return [...prev, { ...line, cartId: nextCartId.current++ }];
      return prev.map(l => (l.cartId === twin.cartId ? { ...l, qty: Math.min(l.qty + 1, 99) } : l));
    });
  }

  /** The sale is saved as held and on its way: a reload must not offer these lines again. */
  function charging(posRef: string | null): void {
    try {
      if (posRef) localStorage.setItem(`${storageKey}:charging`, posRef);
      else localStorage.removeItem(`${storageKey}:charging`);
    } catch {
      // Without storage nothing was kept to restore, so there is nothing to guard.
    }
  }

  return { lines, add, addOne, replace, changeQty, clear: () => setLines([]), charging };
}
