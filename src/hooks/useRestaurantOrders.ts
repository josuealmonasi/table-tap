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
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    function handleChange(row: Order | undefined, eventType: string) {
      if (!row || row.status === "pending_payment") return;
      setOrders((prev) => {
        const exists = prev.find((o) => o.id === row.id);
        return exists ? prev.map((o) => (o.id === row.id ? row : o)) : [row, ...prev];
      });
      if (eventType === "INSERT" || (eventType === "UPDATE" && row.status === "received")) playPing();
    }

    (async () => {
      // Orders are owner-only under RLS, so the realtime socket must carry the
      // owner's token — otherwise every change is filtered out.
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`orders-${restaurantId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
          (payload) => handleChange(payload.new as Order, payload.eventType)
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
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

  /**
   * Cancels (and refunds, if paid) an order. NOT optimistic — money moves, so
   * we wait for the server. Returns an error message to show, or null on success.
   */
  async function cancelOrder(id: string): Promise<string | null> {
    try {
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) return data.error ?? "Could not cancel the order.";
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: "cancelled" } : o)));
      return null;
    } catch {
      return "Network error — please try again.";
    }
  }

  return { orders, updateStatus, cancelOrder };
}
