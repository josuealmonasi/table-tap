"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderLineItem } from "@/lib/types";
import { MAX_LINE_QTY } from "@/lib/pricing";

/** A cart line is an order line item plus a client-side id for list keys/removal. */
export type CartItem = OrderLineItem & { cartId: number };

const storageKey = (restaurantId: string) => `tt-cart:${restaurantId}`;

/** The same dish ordered the same way — extras, options and note included. */
function sameChoice(a: OrderLineItem, b: OrderLineItem): boolean {
  return (
    a.itemId === b.itemId &&
    a.comboId === b.comboId &&
    (a.notes ?? "") === (b.notes ?? "") &&
    JSON.stringify(a.mods ?? {}) === JSON.stringify(b.mods ?? {}) &&
    JSON.stringify((a.extras ?? []).map(e => e.id).sort()) ===
      JSON.stringify((b.extras ?? []).map(e => e.id).sort())
  );
}

const capQty = (qty: number) => Math.min(MAX_LINE_QTY, qty);

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

  /**
   * Adds a line, folding it into an identical one if the cart already has it.
   *
   * Tapping the same drink three times used to give three rows of one, which
   * reads as a mistake and makes the cart longer than the order. "Identical"
   * has to mean every choice as well as the dish — a Coke with ice and a Coke
   * without are two different things to the person drinking them.
   */
  function addItem(line: OrderLineItem) {
    setItems(prev => {
      const twin = prev.findIndex(l => sameChoice(l, line));
      if (twin === -1) return [...prev, { ...line, cartId: nextId.current++ }];
      return prev.map((l, i) => (i === twin ? { ...l, qty: capQty(l.qty + line.qty) } : l));
    });
  }

  function removeItem(cartId: number) {
    setItems(prev => prev.filter(i => i.cartId !== cartId));
  }

  /**
   * Sets how many of a line are ordered, from the cart's own stepper.
   *
   * Never drops to zero: removing is a separate, confirmed action, so a line
   * can't quietly vanish from under the customer.
   */
  function setQty(cartId: number, qty: number) {
    const next = Math.max(1, Math.floor(qty));
    setItems(prev => prev.map(i => (i.cartId === cartId ? { ...i, qty: next } : i)));
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

  return { items, addItem, removeItem, setQty, updateItem, removeExtras, clear, count };
}
