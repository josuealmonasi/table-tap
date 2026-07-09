"use client";

import { useEffect, useRef, useState } from "react";
import type { RestaurantTable } from "@/lib/types";

interface ServiceButtonsProps {
  restaurantId: string;
  table: RestaurantTable;
}

type Kind = "waiter" | "bill";

const LABELS: Record<Kind, { idle: string; sent: string }> = {
  waiter: { idle: "🛎️ Call waiter", sent: "🛎️ On the way!" },
  bill: { idle: "🧾 Get the bill", sent: "🧾 Bill requested" },
};

/**
 * "Call waiter" / "request bill" buttons for dine-in customers. Each sends a
 * service request and then rests for a minute so a tapping child can't spam
 * the kitchen.
 */
export default function ServiceButtons({ restaurantId, table }: ServiceButtonsProps) {
  const [sent, setSent] = useState<Set<Kind>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  async function send(kind: Kind): Promise<void> {
    setSent((prev) => new Set(prev).add(kind));
    timers.current.push(
      setTimeout(() => {
        setSent((prev) => {
          const next = new Set(prev);
          next.delete(kind);
          return next;
        });
      }, 60_000)
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
  }

  return (
    <div className="tt-service-row">
      {(Object.keys(LABELS) as Kind[]).map((kind) => (
        <button
          key={kind}
          type="button"
          className="tt-service-btn"
          disabled={sent.has(kind)}
          onClick={() => send(kind)}
        >
          {sent.has(kind) ? LABELS[kind].sent : LABELS[kind].idle}
        </button>
      ))}
    </div>
  );
}
