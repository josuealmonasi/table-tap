"use client";

import { useEffect, useRef, useState } from "react";
import { recallOrders } from "@/lib/recent-order";
import type { RateableDish } from "@/lib/ratings";
import RateDishesSheet from "./RateDishesSheet";
import type { RestaurantTable } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { CallWaiterIcon } from "@/components/ui/icons";

interface ServiceButtonsProps {
  restaurantId: string;
  table: RestaurantTable;

}

/**
 * Calling the waiter, and nothing else.
 *
 * "Ask for the bill" is gone: when the bill can be seen, asking for it is not
 * an action — it is looking at it. The menu opens that screen, and inside are
 * both ways of paying it. Leaving a button that only says "bring me the bill"
 * was a third door into the same room.
 */
type Kind = "waiter";

// Message keys per button state (resolved through t() at render).
const KEYS: Record<Kind, { idle: string; sent: string }> = {
  waiter: { idle: "service.callWaiter", sent: "service.waiterSent" },
};

/**
 * "Call waiter" / "request bill" buttons for dine-in customers. Each sends a
 * service request and then rests for a minute so a tapping child can't spam
 * the kitchen.
 */
export default function ServiceButtons({
  restaurantId,
  table,
}: ServiceButtonsProps) {
  const t = useT();
  const toast = useToast();
  const [sent, setSent] = useState<Set<Kind>>(new Set());
  // Asking for the bill is the moment the meal is over, which is the only
  // moment a rating prompt isn't an interruption.
  const [rateable, setRateable] = useState<RateableDish[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const release = (kind: Kind): void =>
    setSent(prev => {
      const next = new Set(prev);
      next.delete(kind);
      return next;
    });

  /**
   * The answer is read. It was thrown away, and "¡En camino!" was shown for a
   * minute whatever came back: a rate limit from the room's Wi-Fi, a table
   * that no longer exists, no connection at all. The bill's "pay at the table"
   * was fixed for exactly this; this button, the one on the menu, was not.
   */
  async function send(kind: Kind): Promise<void> {
    setSent(prev => new Set(prev).add(kind));
    try {
      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, tableId: table.id, kind }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        release(kind);
        toast(data.error ?? t("done.networkError"), "error");
        return;
      }
    } catch {
      release(kind);
      toast(t("done.networkError"), "error");
      return;
    }
    // Rests for a minute once it has really gone, so a tapping child cannot
    // call the waiter ten times.
    timers.current.push(setTimeout(() => release(kind), 60_000));

    // Only after the request has gone out, so the prompt can never delay
    // the thing they actually pressed.
    void offerRatings();
  }

  /**
   * Asks the server which dishes this device is entitled to rate. The ids come
   * from local storage, but they prove nothing on their own — the server
   * re-reads each order and returns only paid ones belonging to this
   * restaurant. No orders, no prompt.
   */
  async function offerRatings(): Promise<void> {
    const orderIds = recallOrders(restaurantId);
    if (orderIds.length === 0) return;
    try {
      const res = await fetch("/api/ratings/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, orderIds }),
      });
      const data = await res.json();
      if (Array.isArray(data.dishes) && data.dishes.length > 0) setRateable(data.dishes);
    } catch {
      // Silence is right here: nobody asked to rate anything.
    }
  }

  return (
    <>
        {(Object.keys(KEYS) as Kind[])
          .map(kind => (
            <button
              key={kind}
              type="button"
              className="tt-service-btn"
              disabled={sent.has(kind)}
              onClick={() => void send(kind)}
            >
              <CallWaiterIcon size={16} weight="bold" />
              {t(sent.has(kind) ? KEYS[kind].sent : KEYS[kind].idle)}
            </button>
          ))}
      <RateDishesSheet
        open={rateable.length > 0}
        dishes={rateable}
        restaurantId={restaurantId}
        onClose={() => setRateable([])}
      />
    </>
  );
}
