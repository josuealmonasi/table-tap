"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TableBill } from "@/lib/table-bill";
import { receiptTargets } from "@/lib/receipt-offer";

const SETTLING = "tt.settling"; // what a card settlement is paying for
const ASKED = "tt.receipt.asked"; // what we have already offered a receipt for

function read(key: string): string[] {
  try {
    const raw = sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Remember which orders paid for by card are about to come back from Stripe. */
export function rememberSettling(orderIds: string[]): void {
  try {
    sessionStorage.setItem(SETTLING, JSON.stringify(orderIds));
  } catch {
    // A phone with storage switched off simply doesn't get asked.
  }
}

/**
 * When to offer a receipt, and for what.
 *
 * A receipt is offered once, at the moment the money is settled, whichever way
 * that happened:
 *
 * - paying for one order by card, which comes back to `/order/<id>?paid=1`;
 * - settling the table by card, which comes back to the menu with `?settled=1`
 *   and the ids the bill sheet stashed on the way out;
 * - paying the waiter in cash, which nothing redirects — the bill is polled
 *   while the sheet is open, so the offer is triggered by watching it go from
 *   owing something to owing nothing.
 *
 * Asked orders are remembered for the tab, so refreshing the page — or leaving
 * `?paid=1` sitting in the address bar — cannot turn one question into several.
 * That memory lives in sessionStorage rather than state because the redirect
 * back from Stripe is a fresh page, not a re-render.
 */
export function useReceiptOffer(
  /** False when no mail provider is configured: nothing is offered at all. */
  enabled: boolean,
  paidOrderId: string | null,
  bill: TableBill | null,
): { offering: string[] | null; dismiss: () => void } {
  const [offering, setOffering] = useState<string[] | null>(null);
  // The bill as it was while it was still owed: once it settles the orders are
  // gone from it, and those are exactly the ones the receipt is for.
  const owed = useRef<string[]>([]);
  const settled = useRef<boolean | null>(null);

  const offer = useCallback((ids: string[]) => {
    if (!enabled) return;
    const fresh = ids.filter(id => id && !read(ASKED).includes(id));
    if (fresh.length === 0) return;
    try {
      sessionStorage.setItem(ASKED, JSON.stringify([...read(ASKED), ...fresh]));
    } catch {
      // Not remembering is better than not asking.
    }
    setOffering(fresh);
  }, [enabled]);

  // Back from Stripe. Runs once: the params are read at load, and clearing the
  // stash keeps a later settlement from reusing them.
  useEffect(() => {
    offer(
      receiptTargets({
        search: window.location.search,
        paidOrderId,
        settling: read(SETTLING),
        asked: read(ASKED),
      }),
    );
    try {
      sessionStorage.removeItem(SETTLING);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cash: the waiter takes the money and marks the table paid, and the polled
  // bill empties out under the diner.
  useEffect(() => {
    if (!bill) return;
    const was = settled.current;
    settled.current = bill.settled;
    if (!bill.settled) {
      // Their own orders when they have any; otherwise they are paying for
      // somebody else's, which is still their receipt to ask for.
      const mine = bill.mine.orders.map(o => o.id);
      owed.current = mine.length > 0 ? mine : bill.others.orders.map(o => o.id);
      return;
    }
    if (was === false && owed.current.length > 0) offer(owed.current);
  }, [bill, offer]);

  return { offering, dismiss: () => setOffering(null) };
}
