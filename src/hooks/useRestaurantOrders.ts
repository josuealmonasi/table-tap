"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Order, OrderStatus } from "@/lib/types";

/** Short, gentle ping so kitchen staff notice a new order without looking. */
function playPing() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // AudioContext can be blocked before user interaction — safe to ignore.
  }
}

/**
 * Live order feed for one restaurant: seeds from server-rendered orders, keeps
 * them in sync via realtime (pinging on new ones), and exposes a status updater
 * with optimistic UI.
 */
export function useRestaurantOrders(restaurantId: string, initialOrders: Order[]) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`orders-${restaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        (payload) => {
          const row = payload.new as Order;
          if (!row || row.status === "pending_payment") return;

          setOrders((prev) => {
            const exists = prev.find((o) => o.id === row.id);
            return exists
              ? prev.map((o) => (o.id === row.id ? row : o))
              : [row, ...prev];
          });

          const isNewlyReceived =
            payload.eventType === "INSERT" ||
            (payload.eventType === "UPDATE" && row.status === "received");
          if (isNewlyReceived) playPing();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  async function updateStatus(id: string, status: OrderStatus) {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o))); // optimistic
    await fetch("/api/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  }

  return { orders, updateStatus };
}
