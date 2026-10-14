"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { readyToDeliver, type ReadyTable } from "@/lib/ready-tables";
import { orderCode, type Order } from "@/lib/types";

const LIVE = new Set(["received", "preparing", "ready"]);

/**
 * The counter's orders as they move through the kitchen, for the till to call
 * out the ready ones by code — quietly: the till is ringing up the next
 * customer, and a ping for every order it just rang would be noise.
 */
export function useCounterPickup(restaurantId: string, initial: Order[]): {
  ready: ReadyTable[];
  handOver: (pickup: ReadyTable) => Promise<void>;
} {
  const t = useT();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>(initial);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      // Orders are staff-only under RLS: the socket carries the session.
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);
      channel = supabase
        .channel(`till-pickup-${restaurantId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
          payload => {
            const row = payload.new as Order | undefined;
            if (!row?.id || row.table_id) return;
            setOrders(prev => {
              const rest = prev.filter(o => o.id !== row.id);
              return LIVE.has(row.status) ? [...rest, row] : rest;
            });
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  /** The customer took it: the order is done. Only if it is still ready. */
  async function handOver(pickup: ReadyTable): Promise<void> {
    setOrders(prev => prev.filter(o => !pickup.orderIds.includes(o.id)));
    for (const id of pickup.orderIds) {
      let ok = false;
      try {
        const res = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status: "completed", from: "ready" }),
        });
        ok = res.ok;
      } catch {
        // Said below, like a refusal: the order is still on the board.
      }
      if (!ok) toast(t("pos.pickupFailed", { code: orderCode(id) }), "error");
    }
    toast(t("pos.pickedUp", { code: pickup.code ?? "" }));
  }

  return { ready: readyToDeliver(orders).filter(r => r.code !== null), handOver };
}
