"use client";

import { useEffect, useRef, useState } from "react";
import { recallOrders } from "@/lib/recent-order";
import type { RateableDish } from "@/lib/ratings";
import RateDishesSheet from "./RateDishesSheet";
import type { RestaurantTable } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import { CallWaiterIcon } from "@/components/ui/icons";

interface ServiceButtonsProps {
  restaurantId: string;
  table: RestaurantTable;

}

/**
 * Sólo llamar al mesero.
 *
 * "Pedir la cuenta" se fue: cuando la cuenta se puede ver, pedirla no es una
 * acción — es mirarla. El menú abre esa pantalla, y dentro están las dos
 * maneras de pagarla. Dejar además un botón que sólo avisa "tráeme la cuenta"
 * era una tercera puerta al mismo cuarto.
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
