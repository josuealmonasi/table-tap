"use client";

import { plainTwin } from "@/lib/pos-quick";
import { useEffect, useRef, useState } from "react";
import type { CartItem } from "@/hooks/useCart";
import type { OrderLineItem } from "@/lib/types";

/** An account charge sent but not yet answered: the exact request and what the panel shows. */
export interface HeldAccountCharge {
  request: string;
  review: { name: string; amount: number; currency: string };
}

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
 *
 * `maxLines` stops the cart growing past what its sale can carry; `add` and
 * `addOne` answer false when a new line would not fit.
 */
export function usePosCart(restaurantId: string, remember = true, maxLines = Infinity) {
  const [lines, setLines] = useState<CartItem[]>([]);
  const [restored, setRestored] = useState(false);
  const [heldAccount, setHeldAccount] = useState<HeldAccountCharge | null>(null);
  const nextCartId = useRef(1);
  // The lines as of the last change, so several adds in one tap see each other.
  const current = useRef<CartItem[]>([]);
  const storageKey = `tt-pos-cart:${restaurantId}`;
  const chargingKey = `${storageKey}:charging`;
  const accountKey = `${storageKey}:account`;

  function update(next: (prev: CartItem[]) => CartItem[]): void {
    current.current = next(current.current);
    setLines(current.current);
  }

  useEffect(() => {
    if (!remember) return;
    try {
      // A sale was being charged when the page went away. The held receipt is
      // now the record of that money and replays itself; restoring its lines
      // too offered the same food to charge again under a new reference (C1).
      if (localStorage.getItem(chargingKey)) {
        localStorage.removeItem(chargingKey);
        localStorage.removeItem(storageKey);
      }
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          current.current = parsed as CartItem[];
          setLines(current.current);
          nextCartId.current =
            Math.max(0, ...(parsed as CartItem[]).map(l => l.cartId ?? 0)) + 1;
        }
      }
      // An account charge whose answer never came: it may have committed. The
      // retry must send the same request under the same reference, which the
      // server answers with the sale it already rang (bl39 #1).
      const account = localStorage.getItem(accountKey);
      if (account) {
        const parsed = JSON.parse(account) as HeldAccountCharge;
        if (typeof parsed?.request === "string" && parsed.review) setHeldAccount(parsed);
      }
    } catch {
      // A browser that will not give us storage still sells; it just cannot
      // hold a sale across a reload.
    }
    setRestored(true);
  }, [storageKey, chargingKey, accountKey, remember]);

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

  function add(line: OrderLineItem): boolean {
    if (current.current.length >= maxLines) return false;
    update(prev => [...prev, { ...line, cartId: nextCartId.current++ }]);
    return true;
  }

  /** A line edited on the dish screen, kept in its place. */
  function replace(cartId: number, line: OrderLineItem): void {
    update(prev => prev.map(l => (l.cartId === cartId ? { ...line, cartId: l.cartId } : l)));
  }

  function changeQty(cartId: number, qty: number): void {
    update(prev =>
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
  function addOne(line: OrderLineItem): boolean {
    const twin = plainTwin(current.current, line.itemId);
    if (!twin) return add(line);
    update(prev => prev.map(l => (l.cartId === twin.cartId ? { ...l, qty: Math.min(l.qty + 1, 99) } : l)));
    return true;
  }

  /** The sale is saved as held and on its way: a reload must not offer these lines again. */
  function charging(posRef: string | null): void {
    try {
      if (posRef) localStorage.setItem(chargingKey, posRef);
      else localStorage.removeItem(chargingKey);
    } catch {
      // Without storage nothing was kept to restore, so there is nothing to guard.
    }
  }

  /**
   * The sale is resolved: the lines and the marker that they were being
   * charged go together, synchronously, so a reload between the two can
   * neither offer the lines again nor drop a sale still on its way.
   */
  function clear(): void {
    update(() => []);
    if (!remember) return;
    try {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(chargingKey);
    } catch {
      // Nothing was kept.
    }
  }

  /** Kept before the account request is sent; dropped once it is answered for good. */
  function holdAccount(held: HeldAccountCharge | null): void {
    setHeldAccount(held);
    if (!remember) return;
    try {
      if (held) localStorage.setItem(accountKey, JSON.stringify(held));
      else localStorage.removeItem(accountKey);
    } catch {
      // Without storage the retry lives in memory only, as it did before.
    }
  }

  return { lines, add, addOne, replace, changeQty, clear, charging, heldAccount, holdAccount };
}
