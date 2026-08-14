"use client";

import { useEffect, useRef, useState } from "react";
import { recallOrders } from "@/lib/recent-order";
import type { RateableDish } from "@/lib/ratings";
import RateDishesSheet from "./RateDishesSheet";
import type { RestaurantTable } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import { BillIcon, CallWaiterIcon } from "@/components/ui/icons";

interface ServiceButtonsProps {
  restaurantId: string;
  table: RestaurantTable;
  /** The bill screen handles settling, so asking for a bill is redundant. */
  billOnBill?: boolean;
}

type Kind = "waiter" | "bill";

// Message keys per button state (resolved through t() at render).
const KEYS: Record<Kind, { idle: string; sent: string }> = {
  waiter: { idle: "service.callWaiter", sent: "service.waiterSent" },
  bill: { idle: "service.getBill", sent: "service.billSent" },
};

/**
 * "Call waiter" / "request bill" buttons for dine-in customers. Each sends a
 * service request and then rests for a minute so a tapping child can't spam
 * the kitchen.
 */
export default function ServiceButtons({
  billOnBill = false,
  restaurantId,
  table,
}: ServiceButtonsProps) {
  const t = useT();
  const [sent, setSent] = useState<Set<Kind>>(new Set());
  // Asking for the bill is the moment the meal is over, which is the only
  // moment a rating prompt isn't an interruption.
  const [rateable, setRateable] = useState<RateableDish[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  async function send(kind: Kind): Promise<void> {
    setSent(prev => new Set(prev).add(kind));
    timers.current.push(
      setTimeout(() => {
        setSent(prev => {
          const next = new Set(prev);
          next.delete(kind);
          return next;
        });
      }, 60_000),
    );
    try {
      await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, tableId: table.id, kind }),
      });
    } catch {
      // Non-critical — the button re-enables after the cooldown anyway.
    }

    // Only after the bill request has gone out, so the prompt can never delay
    // the thing they actually pressed.
    if (kind === "bill") void offerRatings();
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
      <div className="tt-service-row">
        {(Object.keys(KEYS) as Kind[])
          // Where the diner can see and settle the bill themselves, "get the
          // bill" is the button that had nothing behind it — the complaint
          // that started this. Calling a waiter still means something.
          .filter(kind => !(billOnBill && kind === "bill"))
          .map(kind => (
            <button
              key={kind}
              type="button"
              className="tt-service-btn"
              disabled={sent.has(kind)}
              onClick={() => send(kind)}
            >
              {kind === "waiter" ? (
                <CallWaiterIcon size={16} weight="bold" />
              ) : (
                <BillIcon size={16} weight="bold" />
              )}
              {t(sent.has(kind) ? KEYS[kind].sent : KEYS[kind].idle)}
            </button>
          ))}
      </div>
      <RateDishesSheet
        open={rateable.length > 0}
        dishes={rateable}
        restaurantId={restaurantId}
        onClose={() => setRateable([])}
      />
    </>
  );
}
